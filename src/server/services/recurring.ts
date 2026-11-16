import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { assignmentOccurrences, assignments, businessMembers, notifications, opportunities, opportunitySchedules, renewalOffers } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { ServiceError } from "./identity";
import { assertBusinessPermission } from "./opportunities";
import { moveAssignment } from "./assignments";
import { daysUntilEnd, generateOccurrences, needsRenewalReminder, renewalDateError, termBlockers, today as todayStr } from "../recurring/engine";

type Asg = typeof assignments.$inferSelect;
const ACTIVE = ["confirmed", "in_progress", "submitted", "changes_requested"] as const;
export const HORIZON_DAYS = 56;

async function loadAssignment(userId: string, id: string) {
  const [x] = await db.select({ a: assignments, o: opportunities }).from(assignments).innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).where(eq(assignments.id, id)).limit(1);
  if (!x) throw new ServiceError("Assignment not found", "not_found");
  if (x.a.workerId === userId) return { ...x, side: "worker" as const };
  const [m] = await db.select().from(businessMembers).where(and(eq(businessMembers.userId, userId), eq(businessMembers.businessId, x.a.businessId))).limit(1);
  if (m) return { ...x, side: "business" as const };
  throw new ServiceError("Assignment not found", "not_found");
}
const schedule = async (opportunityId: string) => (await db.select().from(opportunitySchedules).where(eq(opportunitySchedules.opportunityId, opportunityId))).map((s) => ({ weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute }));
const notifyBusiness = async (businessId: string, title: string, body: string, href: string, type = "assignment") => {
  for (const m of await db.select({ u: businessMembers.userId, role: businessMembers.role }).from(businessMembers).where(eq(businessMembers.businessId, businessId))) if (m.role !== "member") await notify(m.u, type, title, body, href);
};

/** Materialise sessions for the rolling horizon (and the whole term if it is shorter). Idempotent. */
export async function ensureOccurrences(a: Asg, o: { recurring: boolean; id: string }, now = new Date()) {
  if (!o.recurring || !ACTIVE.includes(a.status as (typeof ACTIVE)[number])) return 0;
  const sched = await schedule(o.id); if (!sched.length) return 0;
  const t = todayStr(now);
  const start = a.startDate ?? a.createdAt.toISOString().slice(0, 10);
  const occ = generateOccurrences({ schedule: sched, start, end: a.endDate, from: start > t ? start : t, horizonDays: HORIZON_DAYS });
  if (!occ.length) return 0;
  const res = await db.insert(assignmentOccurrences).values(occ.map((x) => ({ assignmentId: a.id, ...x }))).onConflictDoNothing().returning({ id: assignmentOccurrences.id });
  return res.length;
}

export async function getRecurringView(userId: string, assignmentId: string, now = new Date()) {
  const x = await loadAssignment(userId, assignmentId);
  const sched = await schedule(x.o.id);
  if (!(x.o.recurring && sched.length)) return null;
  await ensureOccurrences(x.a, x.o, now);
  const t = todayStr(now);
  // Sessions auto-cancelled by ending the term are bookkeeping, not events: hide them from lists and counts.
  const all = (await db.select().from(assignmentOccurrences).where(eq(assignmentOccurrences.assignmentId, assignmentId)).orderBy(assignmentOccurrences.occursOn, assignmentOccurrences.startMinute))
    .filter((o) => !(o.status === "cancelled" && o.cancelReason === "Term ended"));
  const renewals = await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, assignmentId)).orderBy(desc(renewalOffers.createdAt));
  const blockers = termBlockers(all.map((o) => ({ occursOn: o.occursOn, status: o.status, confirmed: !!o.confirmedAt })), t);
  return {
    side: x.side, assignment: x.a, today: t, preferSameWorker: x.o.preferSameWorker,
    past: all.filter((o) => o.occursOn < t).slice(-30), upcoming: all.filter((o) => o.occursOn >= t).slice(0, 20),
    totals: {
      completedHours: all.filter((o) => o.status === "completed").reduce((n, o) => n + Number(o.hours ?? 0), 0),
      completed: all.filter((o) => o.status === "completed").length, missed: all.filter((o) => o.status === "missed").length, cancelled: all.filter((o) => o.status === "cancelled").length,
    },
    blockers, renewals, pendingRenewal: renewals.find((r) => r.status === "pending") ?? null, daysLeft: daysUntilEnd(x.a.endDate, t),
  };
}

async function loadOcc(userId: string, occId: string) {
  const [r] = await db.select({ oc: assignmentOccurrences, a: assignments, o: opportunities }).from(assignmentOccurrences).innerJoin(assignments, eq(assignments.id, assignmentOccurrences.assignmentId)).innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).where(eq(assignmentOccurrences.id, occId)).limit(1);
  if (!r) throw new ServiceError("Session not found", "not_found");
  const x = await loadAssignment(userId, r.a.id); // throws not_found for outsiders
  if (!ACTIVE.includes(r.a.status as (typeof ACTIVE)[number])) throw new ServiceError("This assignment is closed");
  return { ...r, side: x.side };
}

const logSchema = z.object({ hours: z.coerce.number().positive("Enter the hours worked").max(24).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)), note: z.string().trim().max(1000).optional() });

/** Worker: record that a session happened (today or earlier). Hourly work needs the hours. */
export async function logSession(workerId: string, occId: string, raw: unknown, now = new Date()) {
  const r = await loadOcc(workerId, occId);
  if (r.side !== "worker") throw new ServiceError("Session not found", "not_found");
  if (r.oc.status !== "scheduled") throw new ServiceError("This session was already recorded");
  if (r.oc.occursOn > todayStr(now)) throw new ServiceError("You can record a session once it has taken place");
  const i = logSchema.parse(raw);
  if (r.a.payType === "hourly" && !i.hours) throw new ServiceError("Enter the hours you worked for this hourly assignment");
  await db.update(assignmentOccurrences).set({ status: "completed", hours: i.hours?.toString() ?? null, workerNote: i.note || null }).where(and(eq(assignmentOccurrences.id, occId), eq(assignmentOccurrences.status, "scheduled")));
  if (r.a.status === "confirmed") await moveAssignment(r.a, "in_progress", workerId);
  await audit(workerId, "occurrence.logged", "assignment", r.a.id, { date: r.oc.occursOn });
  await notifyBusiness(r.a.businessId, "Session recorded", `A session on ${r.oc.occursOn} of “${r.o.title}” was recorded and awaits your confirmation.`, `/business/assignments/${r.a.id}`);
}

/** Worker can't make an upcoming session, or the business cancels one: recorded with a reason, other party told. */
export async function cancelSession(userId: string, occId: string, reason: string, now = new Date()) {
  const r = await loadOcc(userId, occId);
  if (r.oc.status !== "scheduled") throw new ServiceError("Only scheduled sessions can be cancelled");
  if (r.oc.occursOn < todayStr(now)) throw new ServiceError("This session is in the past — record it or mark it missed instead");
  if (reason.trim().length < 5) throw new ServiceError("Give a short reason");
  if (r.side === "business") await assertBusinessPermission(userId, r.a.businessId, "hiring.decide");
  await db.update(assignmentOccurrences).set({ status: "cancelled", cancelReason: reason.trim(), cancelledBy: userId }).where(eq(assignmentOccurrences.id, occId));
  await audit(userId, "occurrence.cancelled", "assignment", r.a.id, { date: r.oc.occursOn, by: r.side });
  if (r.side === "worker") await notifyBusiness(r.a.businessId, "Session cancelled by the worker", `The ${r.oc.occursOn} session of “${r.o.title}” was cancelled: ${reason.trim()}`, `/business/assignments/${r.a.id}`);
  else await notify(r.a.workerId, "assignment", "Session cancelled", `The business cancelled the ${r.oc.occursOn} session of “${r.o.title}”.`, `/worker/assignments/${r.a.id}`);
}

export async function confirmSession(userId: string, occId: string) {
  const r = await loadOcc(userId, occId);
  if (r.side !== "business") throw new ServiceError("Session not found", "not_found");
  await assertBusinessPermission(userId, r.a.businessId, "hiring.decide");
  if (r.oc.status !== "completed") throw new ServiceError("Only recorded sessions can be confirmed");
  if (r.oc.confirmedAt) throw new ServiceError("Already confirmed");
  await db.update(assignmentOccurrences).set({ confirmedAt: new Date(), confirmedBy: userId }).where(eq(assignmentOccurrences.id, occId));
}
export async function confirmAllSessions(userId: string, assignmentId: string) {
  const x = await loadAssignment(userId, assignmentId);
  if (x.side !== "business") throw new ServiceError("Assignment not found", "not_found");
  await assertBusinessPermission(userId, x.a.businessId, "hiring.decide");
  const res = await db.update(assignmentOccurrences).set({ confirmedAt: new Date(), confirmedBy: userId }).where(and(eq(assignmentOccurrences.assignmentId, assignmentId), eq(assignmentOccurrences.status, "completed"), sql`${assignmentOccurrences.confirmedAt} is null`)).returning({ id: assignmentOccurrences.id });
  await audit(userId, "occurrence.confirmed_all", "assignment", assignmentId, { count: res.length });
  return res.length;
}
export async function markMissed(userId: string, occId: string, note: string, now = new Date()) {
  const r = await loadOcc(userId, occId);
  if (r.side !== "business") throw new ServiceError("Session not found", "not_found");
  await assertBusinessPermission(userId, r.a.businessId, "hiring.decide");
  if (r.oc.status !== "scheduled") throw new ServiceError("Only scheduled sessions can be marked missed");
  if (r.oc.occursOn >= todayStr(now)) throw new ServiceError("A session can be marked missed only after its date has passed");
  if (note.trim().length < 5) throw new ServiceError("Add a short note about what happened");
  await db.update(assignmentOccurrences).set({ status: "missed", cancelReason: note.trim(), cancelledBy: userId }).where(eq(assignmentOccurrences.id, occId));
  await audit(userId, "occurrence.missed", "assignment", r.a.id, { date: r.oc.occursOn });
  await notify(r.a.workerId, "assignment", "Session marked as missed", `The ${r.oc.occursOn} session of “${r.o.title}” was marked missed: ${note.trim()}. If this is wrong, message the business.`, `/worker/assignments/${r.a.id}`);
}

/** Business closes out a recurring assignment once every past session is resolved and confirmed. This opens reviews. */
export async function endTerm(userId: string, assignmentId: string, now = new Date()) {
  const x = await loadAssignment(userId, assignmentId);
  if (x.side !== "business") throw new ServiceError("Assignment not found", "not_found");
  await assertBusinessPermission(userId, x.a.businessId, "hiring.decide");
  if (!["confirmed", "in_progress"].includes(x.a.status)) throw new ServiceError("This assignment can’t be completed in its current status");
  const occ = await db.select().from(assignmentOccurrences).where(eq(assignmentOccurrences.assignmentId, assignmentId));
  const b = termBlockers(occ.map((o) => ({ occursOn: o.occursOn, status: o.status, confirmed: !!o.confirmedAt })), todayStr(now));
  if (!b.canEnd) throw new ServiceError(`Before ending the term: ${b.unresolved} past session(s) are unresolved (record or mark missed) and ${b.unconfirmed} recorded session(s) await your confirmation.`);
  await db.transaction(async (tx) => {
    await tx.update(renewalOffers).set({ status: "withdrawn", respondedAt: new Date() }).where(and(eq(renewalOffers.assignmentId, assignmentId), eq(renewalOffers.status, "pending")));
    await tx.update(assignmentOccurrences).set({ status: "cancelled", cancelReason: "Term ended", cancelledBy: userId }).where(and(eq(assignmentOccurrences.assignmentId, assignmentId), eq(assignmentOccurrences.status, "scheduled")));
  });
  await moveAssignment(x.a, "completed", userId, "Term ended", { completedAt: new Date() });
  await notify(x.a.workerId, "assignment", "Assignment completed", `The term of “${x.o.title}” has ended. You can now leave a review.`, `/worker/assignments/${assignmentId}`);
}

// ---------- Renewals ----------
const renewalSchema = z.object({
  newEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  newRate: z.coerce.number().positive().max(100000).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  note: z.string().trim().max(1000).optional(),
});

/** Business proposes extending the term (optionally at a new rate). Nothing changes until the worker accepts. */
export async function proposeRenewal(userId: string, assignmentId: string, raw: unknown, now = new Date()) {
  const x = await loadAssignment(userId, assignmentId);
  if (x.side !== "business") throw new ServiceError("Assignment not found", "not_found");
  await assertBusinessPermission(userId, x.a.businessId, "hiring.decide");
  if (!x.o.recurring) throw new ServiceError("Only recurring assignments can be renewed");
  if (!["confirmed", "in_progress"].includes(x.a.status)) throw new ServiceError("This assignment can’t be renewed in its current status");
  const i = renewalSchema.parse(raw);
  const err = renewalDateError(x.a.endDate, i.newEndDate, todayStr(now)); if (err) throw new ServiceError(err);
  try {
    await db.insert(renewalOffers).values({ assignmentId, proposedBy: userId, newEndDate: i.newEndDate, newAgreedCents: i.newRate ? Math.round(i.newRate * 100) : null, note: i.note || null });
  } catch (e: any) { if (e?.cause?.code === "23505" || e?.code === "23505") throw new ServiceError("There is already a pending renewal offer for this assignment", "conflict"); throw e; }
  await audit(userId, "renewal.proposed", "assignment", assignmentId, { newEndDate: i.newEndDate, newRate: i.newRate });
  await notify(x.a.workerId, "assignment", "Renewal offer", `${x.o.title}: the business proposes extending to ${i.newEndDate}${i.newRate ? ` at $${i.newRate.toFixed(2)}` : ""}. You decide — nothing changes unless you accept.`, `/worker/assignments/${assignmentId}`);
}

export async function respondToRenewal(workerId: string, offerId: string, decision: "accept" | "decline", now = new Date()) {
  const [r] = await db.select({ f: renewalOffers, a: assignments, o: opportunities }).from(renewalOffers).innerJoin(assignments, eq(assignments.id, renewalOffers.assignmentId)).innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).where(eq(renewalOffers.id, offerId)).limit(1);
  if (!r || r.a.workerId !== workerId) throw new ServiceError("Offer not found", "not_found");
  if (r.f.status !== "pending") throw new ServiceError("This offer was already answered or has expired");
  if (decision === "decline") {
    await db.update(renewalOffers).set({ status: "declined", respondedAt: new Date() }).where(eq(renewalOffers.id, offerId));
    await audit(workerId, "renewal.declined", "assignment", r.a.id);
    await notifyBusiness(r.a.businessId, "Renewal declined", `The worker declined to renew “${r.o.title}”. The term still ends on ${r.a.endDate}.`, `/business/assignments/${r.a.id}`, "renewal");
    return;
  }
  const err = renewalDateError(r.a.endDate, r.f.newEndDate, todayStr(now)); if (err) throw new ServiceError(err);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from assignments where id = ${r.a.id} for update`);
    const [fresh] = await tx.select().from(renewalOffers).where(eq(renewalOffers.id, offerId)).for("update");
    if (fresh.status !== "pending") throw new ServiceError("This offer was just updated", "conflict");
    if (!["confirmed", "in_progress"].includes(r.a.status)) throw new ServiceError("This assignment is no longer active");
    await tx.update(renewalOffers).set({ status: "accepted", respondedAt: new Date() }).where(eq(renewalOffers.id, offerId));
    await tx.update(assignments).set({ endDate: r.f.newEndDate, ...(r.f.newAgreedCents ? { agreedCents: r.f.newAgreedCents } : {}), updatedAt: new Date() }).where(eq(assignments.id, r.a.id));
    await audit(workerId, "renewal.accepted", "assignment", r.a.id, { newEndDate: r.f.newEndDate, newAgreedCents: r.f.newAgreedCents }, tx);
  });
  const [updated] = await db.select().from(assignments).where(eq(assignments.id, r.a.id));
  await ensureOccurrences(updated, r.o, now);
  await notifyBusiness(r.a.businessId, "Renewal accepted", `The worker accepted: “${r.o.title}” now runs to ${r.f.newEndDate}.`, `/business/assignments/${r.a.id}`, "renewal");
}

export async function withdrawRenewal(userId: string, offerId: string) {
  const [r] = await db.select({ f: renewalOffers, a: assignments }).from(renewalOffers).innerJoin(assignments, eq(assignments.id, renewalOffers.assignmentId)).where(eq(renewalOffers.id, offerId)).limit(1);
  if (!r) throw new ServiceError("Offer not found", "not_found");
  const x = await loadAssignment(userId, r.a.id); if (x.side !== "business") throw new ServiceError("Offer not found", "not_found");
  await assertBusinessPermission(userId, r.a.businessId, "hiring.decide");
  if (r.f.status !== "pending") throw new ServiceError("This offer was already answered");
  await db.update(renewalOffers).set({ status: "withdrawn", respondedAt: new Date() }).where(eq(renewalOffers.id, offerId));
}

/**
 * Scheduled job (`npm run renewals:run`): (1) expire pending offers whose term already ended, (2) remind managers/owners once a week
 * when an active recurring assignment ends within 14 days with no pending offer, (3) top up rolling sessions.
 */
export async function runRenewalJob(now = new Date()) {
  const t = todayStr(now);
  const expired = await db.update(renewalOffers).set({ status: "expired", respondedAt: now }).where(and(eq(renewalOffers.status, "pending"), inArray(renewalOffers.assignmentId, db.select({ id: assignments.id }).from(assignments).where(lt(assignments.endDate, t)))))
    .returning({ id: renewalOffers.id });
  const rows = await db.select({ a: assignments, o: opportunities }).from(assignments).innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).where(and(eq(opportunities.recurring, true), inArray(assignments.status, ["confirmed", "in_progress"])));
  let reminded = 0, topped = 0;
  for (const { a, o } of rows) {
    topped += await ensureOccurrences(a, o, now);
    if (!needsRenewalReminder(a.endDate, t)) continue;
    const [pending] = await db.select({ id: renewalOffers.id }).from(renewalOffers).where(and(eq(renewalOffers.assignmentId, a.id), eq(renewalOffers.status, "pending")));
    if (pending) continue;
    const [recent] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.type, "renewal"), eq(notifications.href, `/business/assignments/${a.id}`), gte(notifications.createdAt, new Date(now.getTime() - 7 * 86400_000)), sql`${notifications.title} like 'Term ending%'`)).limit(1);
    if (recent) continue;
    const left = a.endDate ? Math.max(0, Math.round((Date.parse(a.endDate) - Date.parse(t)) / 86400_000)) : 0;
    await notifyBusiness(a.businessId, `Term ending soon — ${o.title}`, `The term ends in ${left} day${left === 1 ? "" : "s"} (${a.endDate}). ${o.preferSameWorker ? "You prefer to renew with the same worker — " : ""}propose a renewal or let it end.`, `/business/assignments/${a.id}`, "renewal");
    reminded++;
  }
  return { expired: expired.length, reminded, sessionsCreated: topped };
}
