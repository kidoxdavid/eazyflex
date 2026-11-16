import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { assignmentHistory, assignmentSubmissions, assignments, businessMembers, businesses, opportunities, reviews, users } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { ServiceError } from "./identity";
import { privateName } from "./matching";

type Status = typeof assignments.$inferSelect["status"];
const OPEN: Status[] = ["confirmed", "in_progress", "submitted", "changes_requested"];

async function load(userId: string, id: string) {
  const [a] = await db.select({ a: assignments, title: opportunities.title }).from(assignments).innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).where(eq(assignments.id, id)).limit(1);
  if (!a) throw new ServiceError("Assignment not found", "not_found");
  if (a.a.workerId === userId) return { ...a, side: "worker" as const };
  const [m] = await db.select().from(businessMembers).where(and(eq(businessMembers.userId, userId), eq(businessMembers.businessId, a.a.businessId))).limit(1);
  if (m) return { ...a, side: "business" as const };
  throw new ServiceError("Assignment not found", "not_found"); // outsiders cannot tell it exists
}

async function move(a: typeof assignments.$inferSelect, to: Status, actorId: string, note?: string, extra: Partial<typeof assignments.$inferInsert> = {}) {
  await db.transaction(async (tx) => {
    const [fresh] = await tx.select({ s: assignments.status }).from(assignments).where(eq(assignments.id, a.id)).for("update");
    if (fresh.s !== a.status) throw new ServiceError("This assignment was just updated. Refresh and try again.", "conflict");
    await tx.update(assignments).set({ status: to, updatedAt: new Date(), ...extra }).where(eq(assignments.id, a.id));
    await tx.insert(assignmentHistory).values({ assignmentId: a.id, fromStatus: a.status, toStatus: to, actorId, note: note ?? null });
    await audit(actorId, `assignment.${to}`, "assignment", a.id, { from: a.status }, tx);
  });
}

async function notifyBusiness(businessId: string, title: string, body: string, href: string) {
  for (const m of await db.select({ u: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, businessId))) await notify(m.u, "assignment", title, body, href);
}

export const submitSchema = z.object({
  note: z.string().trim().min(10, "Describe what you are submitting (at least 10 characters)").max(3000),
  hoursWorked: z.coerce.number().positive().max(500).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  link: z.string().trim().url("Link must be a valid URL").max(500).optional().or(z.literal("")).transform((v) => v || undefined),
});

export async function workerAction(userId: string, id: string, action: "start" | "submit" | "cancel", input: Record<string, unknown> = {}) {
  const x = await load(userId, id);
  if (x.side !== "worker") throw new ServiceError("Assignment not found", "not_found");
  const a = x.a;
  if (action === "start") {
    if (a.status !== "confirmed") throw new ServiceError("This assignment has already started");
    await move(a, "in_progress", userId);
    await notifyBusiness(a.businessId, "Work started", `Work has started on “${x.title}”.`, `/business/assignments/${id}`);
  } else if (action === "submit") {
    if (!["confirmed", "in_progress", "changes_requested"].includes(a.status)) throw new ServiceError("You can’t submit work in the current status");
    const i = submitSchema.parse(input);
    if (a.payType === "hourly" && !i.hoursWorked) throw new ServiceError("Enter the hours you worked for this hourly assignment");
    await db.insert(assignmentSubmissions).values({ assignmentId: id, note: i.note, hoursWorked: i.hoursWorked?.toString() ?? null, link: i.link ?? null });
    await move(a, "submitted", userId);
    await notifyBusiness(a.businessId, "Work submitted", `Work was submitted on “${x.title}” and needs your review.`, `/business/assignments/${id}`);
  } else {
    if (!OPEN.includes(a.status) || a.status === "submitted") throw new ServiceError("This assignment can’t be cancelled now — contact the business or report a problem");
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 5) throw new ServiceError("Give a short reason for cancelling");
    await move(a, "cancelled", userId, reason, { cancelReason: reason, cancelledBy: userId });
    await notifyBusiness(a.businessId, "Assignment cancelled", `The worker cancelled “${x.title}”.`, `/business/assignments/${id}`);
  }
}

export async function businessAction(userId: string, id: string, action: "approve" | "request_changes" | "cancel", note = "") {
  const x = await load(userId, id);
  if (x.side !== "business") throw new ServiceError("Assignment not found", "not_found");
  const a = x.a;
  if (action === "cancel") {
    if (!OPEN.includes(a.status)) throw new ServiceError("This assignment is already closed");
    if (note.trim().length < 5) throw new ServiceError("Give a short reason for cancelling");
    await move(a, "cancelled", userId, note, { cancelReason: note.trim(), cancelledBy: userId });
    await notify(a.workerId, "assignment", "Assignment cancelled", `“${x.title}” was cancelled by the business.`, `/worker/assignments/${id}`);
    return;
  }
  if (a.status !== "submitted") throw new ServiceError("There is no submitted work to review");
  const [sub] = await db.select().from(assignmentSubmissions).where(and(eq(assignmentSubmissions.assignmentId, id), sql`${assignmentSubmissions.outcome} is null`)).orderBy(desc(assignmentSubmissions.createdAt)).limit(1);
  if (action === "request_changes") {
    if (note.trim().length < 5) throw new ServiceError("Say what needs to change");
    if (sub) await db.update(assignmentSubmissions).set({ outcome: "changes_requested", reviewerNote: note, decidedAt: new Date() }).where(eq(assignmentSubmissions.id, sub.id));
    await move(a, "changes_requested", userId, note);
    await notify(a.workerId, "assignment", "Changes requested", `The business asked for changes on “${x.title}”.`, `/worker/assignments/${id}`);
  } else {
    if (sub) await db.update(assignmentSubmissions).set({ outcome: "approved", reviewerNote: note || null, decidedAt: new Date() }).where(eq(assignmentSubmissions.id, sub.id));
    await move(a, "completed", userId, note || undefined, { completedAt: new Date() });
    await notify(a.workerId, "assignment", "Work approved", `“${x.title}” was approved. You can now leave a review. (Payment is not active in this release.)`, `/worker/assignments/${id}`);
  }
}

export async function listAssignments(userId: string, side: "worker" | "business") {
  const cond = side === "worker" ? eq(assignments.workerId, userId) : inArray(assignments.businessId, db.select({ b: businessMembers.businessId }).from(businessMembers).where(eq(businessMembers.userId, userId)));
  return db.select({ a: assignments, title: opportunities.title, businessName: businesses.name, workerName: users.fullName }).from(assignments)
    .innerJoin(opportunities, eq(opportunities.id, assignments.opportunityId)).innerJoin(businesses, eq(businesses.id, assignments.businessId)).innerJoin(users, eq(users.id, assignments.workerId))
    .where(cond).orderBy(desc(assignments.createdAt)).then((rows) => rows.map((r) => ({ ...r, workerName: side === "business" ? privateName(r.workerName) : r.workerName })));
}

export async function getAssignment(userId: string, id: string) {
  const x = await load(userId, id);
  const [subs, hist, [b], [w]] = await Promise.all([
    db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.assignmentId, id)).orderBy(desc(assignmentSubmissions.createdAt)),
    db.select().from(assignmentHistory).where(eq(assignmentHistory.assignmentId, id)).orderBy(assignmentHistory.createdAt),
    db.select().from(businesses).where(eq(businesses.id, x.a.businessId)), db.select().from(users).where(eq(users.id, x.a.workerId)),
  ]);
  const revs = await visibleReviews(id, userId);
  return { ...x, submissions: subs, history: hist, businessName: b.name, workerName: x.side === "business" ? privateName(w.fullName) : w.fullName, reviews: revs };
}

// ---------- Reviews ----------
export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  quality: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  communication: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  reliability: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  professionalism: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")).transform((v) => (v === "" ? undefined : v)),
  comment: z.string().trim().max(2000).optional(),
});
export const REVIEW_REVEAL_DAYS = 14;

export async function submitReview(userId: string, assignmentId: string, raw: unknown) {
  const x = await load(userId, assignmentId);
  if (x.a.status !== "completed") throw new ServiceError("Reviews open once the assignment is completed");
  const i = reviewSchema.parse(raw);
  let revieweeId = x.a.workerId;
  if (x.side === "worker") {
    const [m] = await db.select().from(businessMembers).where(eq(businessMembers.businessId, x.a.businessId)).orderBy(businessMembers.role).limit(1);
    revieweeId = m.userId;
  }
  try { await db.insert(reviews).values({ assignmentId, reviewerId: userId, revieweeId, rating: i.rating, quality: i.quality, communication: i.communication, reliability: i.reliability, professionalism: i.professionalism, comment: i.comment || null }); }
  catch (e: any) { if (e?.cause?.code === "23505" || e?.code === "23505") throw new ServiceError("You have already reviewed this assignment", "conflict"); throw e; }
  await audit(userId, "review.submitted", "assignment", assignmentId);
  await notify(revieweeId, "review", "A review is waiting", "The other party left a review. It becomes visible once you leave yours (or after 14 days).", x.side === "worker" ? `/business/assignments/${assignmentId}` : `/worker/assignments/${assignmentId}`);
}

/**
 * Blind reviews (anti-retaliation): a review is visible to others only once both parties have reviewed,
 * or REVIEW_REVEAL_DAYS after completion. Reviewers always see their own.
 */
export async function visibleReviews(assignmentId: string, viewerId: string) {
  const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
  const rows = await db.select().from(reviews).where(eq(reviews.assignmentId, assignmentId));
  const revealed = rows.length >= 2 || (a?.completedAt && Date.now() - a.completedAt.getTime() > REVIEW_REVEAL_DAYS * 86400_000);
  return rows.filter((r) => r.reviewerId === viewerId || revealed);
}

/** Public, aggregated worker rating for businesses — only revealed reviews count. */
export async function workerRatingSummary(workerIds: string[]) {
  if (!workerIds.length) return new Map<string, { avg: number; count: number }>();
  const rows = await db.execute(sql`
    select r.reviewee_id as id, avg(r.rating)::float as avg, count(*)::int as count
    from reviews r join assignments a on a.id = r.assignment_id
    where r.reviewee_id in (${sql.join(workerIds.map((i) => sql`${i}::uuid`), sql`, `)})
      and a.worker_id = r.reviewee_id
      and ((select count(*) from reviews r2 where r2.assignment_id = r.assignment_id) >= 2 or a.completed_at < now() - make_interval(days => ${REVIEW_REVEAL_DAYS}))
    group by r.reviewee_id`);
  return new Map((rows.rows as { id: string; avg: number; count: number }[]).map((r) => [r.id, { avg: Math.round(r.avg * 10) / 10, count: r.count }]));
}
