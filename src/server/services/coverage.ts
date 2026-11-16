import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { businesses, coverageSlices, handoverNotes, opportunities, opportunitySchedules, users, workerProfiles } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { ServiceError } from "./identity";
import { assertBusinessMember } from "./opportunities";
import { loadActiveRules, loadOpportunities, loadWorkers, privateName } from "./matching";
import { scoreMatch } from "../matching/score";
import { analyseCoverage, contains, findHandovers, mergeWindows, overlaps, subtractWindows, suggestCoverage, totalMinutes, type Candidate, type Slice, type Win } from "../coverage/engine";

type SliceRow = typeof coverageSlices.$inferSelect;
const toWin = (s: { weekday: number; startMinute: number; endMinute: number }): Win => ({ weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute });
const toSlice = (s: SliceRow): Slice => ({ id: s.id, workerId: s.workerId, status: s.status, ...toWin(s) });
export const fmtWin = (w: Win) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w.weekday]} ${hm(w.startMinute)}–${hm(w.endMinute)}`;
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function ownOpportunity(userId: string, opportunityId: string) {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!o) throw new ServiceError("Opportunity not found", "not_found");
  try { await assertBusinessMember(userId, o.businessId); } catch { throw new ServiceError("Opportunity not found", "not_found"); }
  return o;
}
const requiredWindows = async (opportunityId: string) => (await db.select().from(opportunitySchedules).where(eq(opportunitySchedules.opportunityId, opportunityId))).map(toWin);

/** Time a worker is already committed to via confirmed slices on *other* opportunities. */
async function commitmentsFor(workerIds: string[], excludeOpportunityId?: string) {
  if (!workerIds.length) return new Map<string, Win[]>();
  const rows = await db.select().from(coverageSlices).where(and(inArray(coverageSlices.workerId, workerIds), eq(coverageSlices.status, "confirmed"), excludeOpportunityId ? ne(coverageSlices.opportunityId, excludeOpportunityId) : undefined));
  const m = new Map<string, Win[]>(); for (const r of rows) m.set(r.workerId, [...(m.get(r.workerId) ?? []), toWin(r)]); return m;
}

export async function getCoverageView(userId: string, opportunityId: string) {
  const o = await ownOpportunity(userId, opportunityId);
  const required = await requiredWindows(opportunityId);
  const rows = await db.select({ s: coverageSlices, name: users.fullName }).from(coverageSlices).innerJoin(users, eq(users.id, coverageSlices.workerId)).where(eq(coverageSlices.opportunityId, opportunityId)).orderBy(coverageSlices.weekday, coverageSlices.startMinute);
  const slices = rows.map((r) => ({ ...r.s, workerName: privateName(r.name) }));
  const report = analyseCoverage(required, slices.map(toSlice));
  const notes = await db.select().from(handoverNotes).where(eq(handoverNotes.opportunityId, opportunityId));
  const handovers = findHandovers(slices.map(toSlice)).map((h) => ({ ...h, note: notes.find((n) => n.fromSliceId === h.from.id && n.toSliceId === h.to.id) ?? null }));
  return { opportunity: o, required: mergeWindows(required), slices, report, handovers };
}

/** Eligible, discoverable workers for the opportunity, with their availability. Mandatory-availability is relaxed here: partial availability is the point of work-sharing. */
async function loadCandidates(opportunityId: string) {
  const rules = await loadActiveRules();
  const relaxed = { ...rules, mandatory: (rules.mandatory ?? []).filter((m) => m !== "availability") };
  const pool = await db.select({ id: workerProfiles.userId, name: users.fullName, max: workerProfiles.maxHoursPerWeek }).from(workerProfiles).innerJoin(users, eq(users.id, workerProfiles.userId))
    .where(and(eq(workerProfiles.publicProfile, true), sql`${workerProfiles.onboardingCompletedAt} is not null`, eq(workerProfiles.availabilityPaused, false), eq(users.status, "active"), sql`${users.emailVerifiedAt} is not null`)).limit(500);
  const [ws, os, commits] = await Promise.all([loadWorkers(pool.map((p) => p.id)), loadOpportunities([opportunityId]), commitmentsFor(pool.map((p) => p.id), opportunityId)]);
  const opp = os.get(opportunityId)!;
  const out: { c: Candidate; name: string; explanation: string; score: number }[] = [];
  for (const p of pool) {
    const w = ws.get(p.id)!; const m = scoreMatch(opp, w, relaxed);
    if (!m.eligible) continue;
    out.push({ name: privateName(p.name), explanation: m.explanation, score: m.score, c: { workerId: p.id, score: m.score, availability: w.availability.map(toWin), commitments: commits.get(p.id) ?? [], maxMinutesPerWeek: p.max ? p.max * 60 : null } });
  }
  return out;
}

/** Preview only — nothing is stored or booked. */
export async function suggest(userId: string, opportunityId: string) {
  await ownOpportunity(userId, opportunityId);
  const required = await requiredWindows(opportunityId);
  if (!required.length) throw new ServiceError("This opportunity has no scheduled days/hours to cover");
  const existing = (await db.select().from(coverageSlices).where(eq(coverageSlices.opportunityId, opportunityId))).map(toSlice);
  const cands = await loadCandidates(opportunityId);
  const { suggestions, remainingGaps } = suggestCoverage(required, cands.map((c) => c.c), existing);
  const byId = new Map(cands.map((c) => [c.c.workerId, c]));
  return {
    suggestions: suggestions.map((s) => ({ ...s, workerName: byId.get(s.workerId)!.name, score: byId.get(s.workerId)!.score, explanation: byId.get(s.workerId)!.explanation })),
    remainingGaps, candidateCount: cands.length,
  };
}

export async function proposeSlices(userId: string, opportunityId: string, input: { workerId: string; weekday: number; startMinute: number; endMinute: number }[]) {
  const o = await ownOpportunity(userId, opportunityId);
  if (o.status !== "published") throw new ServiceError("Coverage can be arranged only for published opportunities");
  if (!input.length) throw new ServiceError("Choose at least one slice to propose");
  if (input.length > 60) throw new ServiceError("Too many slices at once");
  const required = await requiredWindows(opportunityId);
  const cands = new Map((await loadCandidates(opportunityId)).map((c) => [c.c.workerId, c.c]));
  const created: SliceRow[] = [];
  await db.transaction(async (tx) => {
    const active = (await tx.select().from(coverageSlices).where(and(eq(coverageSlices.opportunityId, opportunityId), inArray(coverageSlices.status, ["proposed", "confirmed"])))).map(toSlice);
    const planned = [...active];
    for (const s of input) {
      if (!(s.weekday >= 0 && s.weekday <= 6 && s.startMinute >= 0 && s.endMinute <= 1440 && s.endMinute > s.startMinute)) throw new ServiceError("Invalid time window");
      if (!contains(required, s)) throw new ServiceError(`${fmtWin(s)} is outside the hours this opportunity needs covered`);
      const c = cands.get(s.workerId);
      if (!c) throw new ServiceError("That worker is not available to be proposed for this opportunity (not discoverable, missing a required skill, outside the travel radius, or availability paused)");
      const clash = planned.find((p) => overlaps(p, s));
      if (clash) throw new ServiceError(`${fmtWin(s)} overlaps a slice that is already proposed or confirmed`);
      if (c.commitments.some((x) => overlaps(x, { ...s }))) throw new ServiceError(`That worker is already committed elsewhere during ${fmtWin(s)}`);
      const inside = contains(c.availability, s);
      const [row] = await tx.insert(coverageSlices).values({ opportunityId, workerId: s.workerId, weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute, outsideAvailability: !inside, proposedBy: userId }).returning();
      created.push(row); planned.push(toSlice(row));
    }
    await audit(userId, "coverage.proposed", "opportunity", opportunityId, { slices: created.length }, tx);
  });
  for (const w of new Set(created.map((c) => c.workerId))) await notify(w, "coverage", "Shift coverage request", `You were asked to cover part of “${o.title}”. Review and confirm or decline — nothing is booked until you confirm.`, "/worker/coverage");
  return created.length;
}

async function loadSlice(id: string) {
  const [x] = await db.select({ s: coverageSlices, o: opportunities }).from(coverageSlices).innerJoin(opportunities, eq(opportunities.id, coverageSlices.opportunityId)).where(eq(coverageSlices.id, id)).limit(1);
  if (!x) throw new ServiceError("Slice not found", "not_found");
  return x;
}
async function notifyBusinessOf(o: { businessId: string; title: string; id: string }, title: string, body: string) {
  const { businessMembers } = await import("../db/schema");
  for (const m of await db.select({ u: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, o.businessId))) await notify(m.u, "coverage", title, body, `/business/opportunities/${o.id}/coverage`);
}

/**
 * Worker answers a proposal. Confirming is the only way a slice becomes a booking. If the slice is outside their stated
 * availability, or would take them over their weekly maximum, they must explicitly agree (acknowledge). Re-checks clashes at confirm time.
 */
export async function respondToSlice(workerId: string, sliceId: string, decision: "confirm" | "decline", acknowledge = false) {
  const { s, o } = await loadSlice(sliceId);
  if (s.workerId !== workerId) throw new ServiceError("Slice not found", "not_found");
  if (s.status !== "proposed") throw new ServiceError("This request was already answered");
  if (decision === "decline") {
    await db.update(coverageSlices).set({ status: "declined", respondedAt: new Date() }).where(eq(coverageSlices.id, sliceId));
    await audit(workerId, "coverage.declined", "coverage_slice", sliceId);
    await notifyBusinessOf(o, "Coverage declined", `A worker declined a proposed slice of “${o.title}”.`);
    return;
  }
  let complete = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from users where id = ${workerId} for update`); // serialise this worker's confirmations
    const [fresh] = await tx.select().from(coverageSlices).where(eq(coverageSlices.id, sliceId)).for("update");
    if (fresh.status !== "proposed") throw new ServiceError("This request was just updated. Refresh and try again.", "conflict");
    if (o.status !== "published") throw new ServiceError("This opportunity is no longer open");
    const mine = (await tx.select().from(coverageSlices).where(and(eq(coverageSlices.workerId, workerId), eq(coverageSlices.status, "confirmed")))).map(toSlice);
    const clash = mine.find((m) => overlaps(m, fresh));
    if (clash) throw new ServiceError(`You already have a confirmed slice at ${fmtWin(clash)} that overlaps this one`);
    const [p] = await tx.select().from(workerProfiles).where(eq(workerProfiles.userId, workerId));
    const av = (await loadWorkers([workerId])).get(workerId)!.availability.map(toWin);
    const outside = !contains(av, fresh);
    const overCap = p.maxHoursPerWeek != null && totalMinutes(mergeWindows([...mine, toSlice(fresh)])) > p.maxHoursPerWeek * 60;
    if ((outside || overCap) && !acknowledge) throw new ServiceError(`${outside ? "This is outside your stated availability" : "This would take you over your weekly maximum"}. To accept anyway, tick the box to confirm you agree.`);
    await tx.update(coverageSlices).set({ status: "confirmed", respondedAt: new Date(), outsideAvailability: outside, agreedOutside: (outside || overCap) && acknowledge }).where(eq(coverageSlices.id, sliceId));
    await audit(workerId, "coverage.confirmed", "coverage_slice", sliceId, { outside, overCap }, tx);
    const all = (await tx.select().from(coverageSlices).where(eq(coverageSlices.opportunityId, o.id))).map(toSlice);
    const req = (await tx.select().from(opportunitySchedules).where(eq(opportunitySchedules.opportunityId, o.id))).map(toWin);
    complete = analyseCoverage(req, all.map((x) => (x.id === sliceId ? { ...x, status: "confirmed" as const } : x))).complete;
  });
  await notifyBusinessOf(o, complete ? "Coverage complete" : "Coverage confirmed", complete ? `Every required hour of “${o.title}” is now confirmed.` : `A worker confirmed a slice of “${o.title}”.`);
}

/** Either the worker ("give back") or the business releases a confirmed/proposed slice; the gap reappears in the analysis. */
export async function releaseSlice(userId: string, sliceId: string, reason: string) {
  const { s, o } = await loadSlice(sliceId);
  const isWorker = s.workerId === userId;
  if (!isWorker) await ownOpportunity(userId, o.id);
  if (!["proposed", "confirmed"].includes(s.status)) throw new ServiceError("This slice is already closed");
  if (reason.trim().length < 5) throw new ServiceError("Give a short reason");
  await db.transaction(async (tx) => {
    await tx.update(coverageSlices).set({ status: "released", releasedBy: userId, releaseReason: reason.trim() }).where(eq(coverageSlices.id, sliceId));
    await audit(userId, "coverage.released", "coverage_slice", sliceId, { reason }, tx);
  });
  if (isWorker) await notifyBusinessOf(o, "A worker released a slice", `A slice of “${o.title}” is open again: ${fmtWin(s)}.`);
  else await notify(s.workerId, "coverage", "Shift slice released", `The business released ${fmtWin(s)} on “${o.title}”.`, "/worker/coverage");
}

export async function listWorkerCoverage(workerId: string) {
  const rows = await db.select({ s: coverageSlices, title: opportunities.title, oppId: opportunities.id, businessName: businesses.name }).from(coverageSlices)
    .innerJoin(opportunities, eq(opportunities.id, coverageSlices.opportunityId)).innerJoin(businesses, eq(businesses.id, opportunities.businessId))
    .where(and(eq(coverageSlices.workerId, workerId), inArray(coverageSlices.status, ["proposed", "confirmed"]))).orderBy(coverageSlices.weekday, coverageSlices.startMinute);
  const av = (await loadWorkers([workerId])).get(workerId)?.availability.map(toWin) ?? [];
  const [p] = await db.select().from(workerProfiles).where(eq(workerProfiles.userId, workerId));
  const confirmed = rows.filter((r) => r.s.status === "confirmed").map((r) => toSlice(r.s));
  const items = rows.map((r) => {
    const outside = !contains(av, r.s);
    const overCap = r.s.status === "proposed" && p?.maxHoursPerWeek != null && totalMinutes(mergeWindows([...confirmed, toSlice(r.s)])) > p.maxHoursPerWeek * 60;
    const clash = r.s.status === "proposed" ? confirmed.find((c) => overlaps(c, r.s)) : undefined;
    return { ...r, outside, overCap, clash: clash ? fmtWin(clash) : null };
  });
  // handovers involving this worker
  const oppIds = [...new Set(rows.map((r) => r.oppId))];
  const confirmedRows = oppIds.length ? await db.select().from(coverageSlices).where(and(inArray(coverageSlices.opportunityId, oppIds), eq(coverageSlices.status, "confirmed"))) : [];
  const oppOf = new Map(confirmedRows.map((r) => [r.id, r.opportunityId]));
  const notes = oppIds.length ? await db.select().from(handoverNotes).where(inArray(handoverNotes.opportunityId, oppIds)) : [];
  const handovers = findHandovers(confirmedRows.map(toSlice)).filter((h) => h.from.workerId === workerId || h.to.workerId === workerId)
    .map((h) => ({ ...h, direction: h.from.workerId === workerId ? ("outgoing" as const) : ("incoming" as const), oppId: oppOf.get(h.from.id)!, note: notes.find((n) => n.fromSliceId === h.from.id && n.toSliceId === h.to.id) ?? null }));
  return { items, handovers, totalConfirmedMinutes: totalMinutes(mergeWindows(confirmed)) };
}

/** The outgoing worker (or the business) leaves a handover note for the next worker; the incoming worker acknowledges it. */
export async function addHandover(userId: string, fromSliceId: string, toSliceId: string, note: string) {
  const a = await loadSlice(fromSliceId), b = await loadSlice(toSliceId);
  if (a.o.id !== b.o.id) throw new ServiceError("Slices must belong to the same opportunity");
  if (a.s.status !== "confirmed" || b.s.status !== "confirmed") throw new ServiceError("Both slices must be confirmed");
  if (!(a.s.weekday === b.s.weekday && a.s.endMinute === b.s.startMinute && a.s.workerId !== b.s.workerId)) throw new ServiceError("These slices are not consecutive handover slices");
  if (a.s.workerId !== userId) await ownOpportunity(userId, a.o.id); // outgoing worker or the business
  if (note.trim().length < 5) throw new ServiceError("Write a short handover note (what is done, what is pending)");
  try { await db.insert(handoverNotes).values({ opportunityId: a.o.id, fromSliceId, toSliceId, note: note.trim().slice(0, 2000), authorId: userId }); }
  catch (e: any) { if (e?.cause?.code === "23505" || e?.code === "23505") throw new ServiceError("A handover note already exists for this handover", "conflict"); throw e; }
  await notify(b.s.workerId, "coverage", "Handover note", `You have a handover note for ${fmtWin(b.s)} on “${a.o.title}”.`, "/worker/coverage");
  await audit(userId, "handover.added", "opportunity", a.o.id);
}
export async function acknowledgeHandover(workerId: string, noteId: string) {
  const [n] = await db.select({ n: handoverNotes, to: coverageSlices }).from(handoverNotes).innerJoin(coverageSlices, eq(coverageSlices.id, handoverNotes.toSliceId)).where(eq(handoverNotes.id, noteId)).limit(1);
  if (!n || n.to.workerId !== workerId) throw new ServiceError("Handover not found", "not_found");
  await db.update(handoverNotes).set({ acknowledgedAt: new Date() }).where(eq(handoverNotes.id, noteId));
}
export const _s = subtractWindows;

/** Workers who could be proposed manually (same eligibility as suggestions). */
export async function listCandidates(userId: string, opportunityId: string) {
  await ownOpportunity(userId, opportunityId);
  return (await loadCandidates(opportunityId)).map((c) => ({ workerId: c.c.workerId, name: c.name, score: c.score }));
}
