import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { assignmentOccurrences, assignments, notifications, renewalOffers, skills } from "@/server/db/schema";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus } from "@/server/services/applications";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding } from "@/server/services/worker";
import { businessAction, submitReview, workerAction } from "@/server/services/assignments";
import { cancelSession, confirmAllSessions, confirmSession, ensureOccurrences, getRecurringView, logSession, markMissed, endTerm, proposeRenewal, respondToRenewal, runRenewalJob, withdrawRenewal } from "@/server/services/recurring";
import { inviteMember } from "@/server/services/team";
import { registerUser } from "@/server/services/identity";
import { emailOutbox } from "@/server/db/schema";
import { addDays, today, weekdayOf } from "@/server/recurring/engine";
import { closeDb, freshDb, makeUser, ref } from "./helpers";
import { desc } from "drizzle-orm";

beforeAll(freshDb);
afterAll(closeDb);

const T = today();
const SCHED = [{ weekday: 2, startMinute: 600, endMinute: 720 }, { weekday: 4, startMinute: 600, endMinute: 720 }]; // Tue & Thu 10–12
let n = 0;

async function scenario(o: { endInDays?: number | null; payType?: "hourly" | "recurring"; opp?: Record<string, unknown> } = {}) {
  const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Support", summary: "Experienced administrator and customer support agent working part-time.", experienceLevel: "intermediate", skillIds: [sk[0].id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true }); await saveAvailability(w.id, { windows: [{ weekday: 2, startMinute: 540, endMinute: 900 }] }); await completeOnboarding(w.id);
  const end = o.endInDays === null ? undefined : addDays(T, o.endInDays ?? 30);
  const payType = o.payType ?? "hourly";
  const opp = await saveOpportunity(b.id, biz.id, { title: "Tuesday and Thursday admin support", description: "Regular admin support twice a week, answering email and scheduling for a small office.", engagementType: "recurring", categoryId: cat.id, arrangement: "remote", payType, payMin: 28, payMax: 32, hoursPerWeek: 4, recurrenceNote: "Tue & Thu mornings", schedule: SCHED, startDate: T, endDate: end, ...(o.opp ?? {}) }, { publish: true });
  const a = await applyToOpportunity(w.id, { opportunityId: opp.id, proposal: "I have five years of administrative experience and can start immediately.", proposedRate: 30 });
  await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
  const [asg] = await db.select().from(assignments).where(eq(assignments.applicationId, a.id));
  return { b, biz, w, opp, asg, id: asg.id };
}
const occs = (id: string) => db.select().from(assignmentOccurrences).where(eq(assignmentOccurrences.assignmentId, id)).orderBy(assignmentOccurrences.occursOn);
const later = (days: number) => new Date(Date.parse(T + "T12:00:00Z") + days * 86400_000);
async function member(ownerId: string) {
  const email = `rm${Date.now()}${n++}@test.example`; await inviteMember(ownerId, email, "member");
  const [m] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, email), eq(emailOutbox.template, "team_invitation"))).orderBy(desc(emailOutbox.createdAt)).limit(1);
  return registerUser({ kind: "business", fullName: "Read Only", email, password: "CorrectHorse9", acceptTerms: true, inviteToken: new URL(m.link!).searchParams.get("token")! });
}

describe("sessions", () => {
  it("are generated from the weekly schedule within the term, idempotently, and not for one-shot assignments", async () => {
    const s = await scenario({ endInDays: 20 });
    const v = await getRecurringView(s.w.id, s.id); expect(v).not.toBeNull();
    const all = await occs(s.id); expect(all.length).toBeGreaterThanOrEqual(5);
    for (const o of all) { expect([2, 4]).toContain(weekdayOf(o.occursOn)); expect(o.occursOn >= T && o.occursOn <= addDays(T, 20)).toBe(true); expect(o.status).toBe("scheduled"); }
    expect(await ensureOccurrences((await db.select().from(assignments).where(eq(assignments.id, s.id)))[0], { recurring: true, id: s.opp.id })).toBe(0);
    const one = await (async () => { const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await makeUser("worker");
      const o = await saveOpportunity(b.id, biz.id, { title: "One-off spreadsheet tidy", description: "Tidy a spreadsheet so it can be imported into our store without any errors at all.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
      const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of experience tidying spreadsheets for small teams." }); await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
      return { w, asg: (await db.select().from(assignments).where(eq(assignments.applicationId, a.id)))[0] }; })();
    expect(await getRecurringView(one.w.id, one.asg.id)).toBeNull();
  });
  it("open-ended assignments get a rolling window of sessions", async () => {
    const s = await scenario({ endInDays: null }); await getRecurringView(s.w.id, s.id);
    const all = await occs(s.id); expect(all.length).toBeGreaterThanOrEqual(14); expect(all.at(-1)!.occursOn <= addDays(T, 56)).toBe(true);
  });
  it("outsiders cannot see a recurring view", async () => {
    const s = await scenario(); const other = await makeUser("worker"); const otherBiz = await makeUser("business");
    await expect(getRecurringView(other.id, s.id)).rejects.toThrow(/not found/i); await expect(getRecurringView(otherBiz.id, s.id)).rejects.toThrow(/not found/i);
  });
});

describe("logging, confirming, missing, cancelling", () => {
  it("worker records a past session (hours required for hourly), not future ones, not twice; the assignment starts", async () => {
    const s = await scenario(); await getRecurringView(s.w.id, s.id); const all = await occs(s.id); const first = all[0];
    await expect(logSession(s.w.id, first.id, { hours: 2 }, new Date(Date.parse(first.occursOn + "T12:00:00Z") - 86400_000))).rejects.toThrow(/once it has taken place/); // the day before the first session (independent of today's real date)
    const now = later(10); // ten days on, the earlier sessions are in the past
    await expect(logSession(s.w.id, first.id, {}, now)).rejects.toThrow(/Enter the hours/);
    await expect(logSession(s.w.id, first.id, { hours: 30 }, now)).rejects.toThrow();
    await expect(logSession(s.b.id, first.id, { hours: 2 }, now)).rejects.toThrow(/not found/i);
    await logSession(s.w.id, first.id, { hours: 2, note: "Cleared the inbox backlog" }, now);
    await expect(logSession(s.w.id, first.id, { hours: 2 }, now)).rejects.toThrow(/already recorded/);
    expect((await db.select().from(assignments).where(eq(assignments.id, s.id)))[0].status).toBe("in_progress");
    const row = (await occs(s.id))[0]; expect(row.status).toBe("completed"); expect(Number(row.hours)).toBe(2);
    expect((await db.select().from(notifications).where(eq(notifications.userId, s.b.id))).some((x) => x.title === "Session recorded")).toBe(true);
  });
  it("business confirms (single/all), marks missed only after the date, and members can't", async () => {
    const s = await scenario(); const mem = await member(s.b.id); await getRecurringView(s.w.id, s.id); const all = await occs(s.id); const now = later(12);
    const past = all.filter((o) => o.occursOn < addDays(T, 12));
    await logSession(s.w.id, past[0].id, { hours: 2 }, now); await logSession(s.w.id, past[1].id, { hours: 2 }, now);
    await expect(confirmSession(mem.id, past[0].id)).rejects.toThrow(/Your role \(member\)/);
    await expect(confirmSession(s.w.id, past[0].id)).rejects.toThrow(/not found/i);
    await confirmSession(s.b.id, past[0].id); await expect(confirmSession(s.b.id, past[0].id)).rejects.toThrow(/Already confirmed/);
    expect(await confirmAllSessions(s.b.id, s.id)).toBe(1);
    await expect(markMissed(s.b.id, all.at(-1)!.id, "Did not show up")).rejects.toThrow(/after its date has passed/);
    await expect(markMissed(s.b.id, past[2].id, "no", now)).rejects.toThrow(/short note/);
    await markMissed(s.b.id, past[2].id, "Did not log in or reply", now);
    expect((await occs(s.id)).find((o) => o.id === past[2].id)!.status).toBe("missed");
    expect((await db.select().from(notifications).where(eq(notifications.userId, s.w.id))).some((x) => x.title === "Session marked as missed")).toBe(true);
  });
  it("either side cancels an upcoming session with a reason; past sessions can't be cancelled", async () => {
    const s = await scenario(); await getRecurringView(s.w.id, s.id); const all = await occs(s.id);
    const future = all.find((o) => o.occursOn > T)!; const todays = all.find((o) => o.occursOn === T);
    await expect(cancelSession(s.w.id, future.id, "no")).rejects.toThrow(/short reason/);
    await cancelSession(s.w.id, future.id, "Family event that day");
    const f2 = all.filter((o) => o.occursOn > T)[1]; await cancelSession(s.b.id, f2.id, "Office closed that day");
    await expect(cancelSession(s.b.id, future.id, "again please")).rejects.toThrow(/Only scheduled/);
    const untouched = all.find((o) => o.id !== future.id && o.id !== f2.id)!; // still scheduled
    await expect(cancelSession(s.w.id, untouched.id, "too late for this one", later(45))).rejects.toThrow(/in the past/);
    expect(todays === undefined || todays.status === "scheduled").toBe(true);
  });
  it("one-shot submit is blocked on recurring assignments", async () => {
    const s = await scenario();
    await expect(workerAction(s.w.id, s.id, "submit", { note: "All done for this term", hoursWorked: 4 })).rejects.toThrow(/log each session/);
  });
});

describe("ending a term", () => {
  it("is blocked until past sessions are resolved and confirmed; then completes, cancels future sessions, and opens reviews", async () => {
    const s = await scenario({ endInDays: 20 }); await getRecurringView(s.w.id, s.id); const all = await occs(s.id); const now = later(10);
    const past = all.filter((o) => o.occursOn < addDays(T, 10)); expect(past.length).toBeGreaterThan(0);
    await expect(endTerm(s.w.id, s.id, now)).rejects.toThrow(/not found/i);
    await expect(endTerm(s.b.id, s.id, now)).rejects.toThrow(/past session\(s\) are unresolved/);
    for (const o of past) await logSession(s.w.id, o.id, { hours: 2 }, now);
    await expect(endTerm(s.b.id, s.id, now)).rejects.toThrow(/await your confirmation/);
    await confirmAllSessions(s.b.id, s.id);
    await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 60) }, now);
    await endTerm(s.b.id, s.id, now);
    const asg = (await db.select().from(assignments).where(eq(assignments.id, s.id)))[0]; expect(asg.status).toBe("completed"); expect(asg.completedAt).not.toBeNull();
    expect((await occs(s.id)).filter((o) => o.occursOn >= addDays(T, 10)).every((o) => o.status === "cancelled")).toBe(true);
    expect((await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, s.id)))[0].status).toBe("withdrawn");
    await submitReview(s.b.id, s.id, { rating: 5 }); await submitReview(s.w.id, s.id, { rating: 5 });
    await expect(logSession(s.w.id, past[0].id, { hours: 1 }, now)).rejects.toThrow(/already recorded|closed/);
  });
});

describe("renewal offers", () => {
  it("validates: end date required and later, at most a year, recurring only, one pending, managers only, parties only", async () => {
    const open = await scenario({ endInDays: null }); const s = await scenario({ endInDays: 20 }); const mem = await member(s.b.id); const stranger = await makeUser("business");
    await expect(proposeRenewal(open.b.id, open.id, { newEndDate: addDays(T, 90) })).rejects.toThrow(/no end date/);
    await expect(proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 20) })).rejects.toThrow(/after the current end/);
    await expect(proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 500) })).rejects.toThrow(/one year/);
    await expect(proposeRenewal(s.b.id, s.id, { newEndDate: "soon" })).rejects.toThrow();
    await expect(proposeRenewal(mem.id, s.id, { newEndDate: addDays(T, 80) })).rejects.toThrow(/Your role \(member\)/);
    await expect(proposeRenewal(s.w.id, s.id, { newEndDate: addDays(T, 80) })).rejects.toThrow(/not found/i);
    await expect(proposeRenewal(stranger.id, s.id, { newEndDate: addDays(T, 80) })).rejects.toThrow(/not found/i);
    await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 80), note: "Happy to continue" });
    await expect(proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 90) })).rejects.toThrow(/already a pending/);
    expect((await db.select().from(notifications).where(eq(notifications.userId, s.w.id))).some((x) => x.title === "Renewal offer")).toBe(true);
  });
  it("nothing changes until the worker accepts; accepting extends the term, applies the new rate and creates the extra sessions", async () => {
    const s = await scenario({ endInDays: 20 }); await getRecurringView(s.w.id, s.id); const before = (await occs(s.id)).length;
    await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 50), newRate: 33.5 });
    const unchanged = (await db.select().from(assignments).where(eq(assignments.id, s.id)))[0]; expect(unchanged.endDate).toBe(addDays(T, 20)); expect(unchanged.agreedCents).toBe(3000);
    const offer = (await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, s.id)))[0];
    const other = await makeUser("worker"); await expect(respondToRenewal(other.id, offer.id, "accept")).rejects.toThrow(/not found/i);
    await respondToRenewal(s.w.id, offer.id, "accept");
    const after = (await db.select().from(assignments).where(eq(assignments.id, s.id)))[0];
    expect(after.endDate).toBe(addDays(T, 50)); expect(after.agreedCents).toBe(3350);
    expect((await occs(s.id)).length).toBeGreaterThan(before); expect((await occs(s.id)).every((o) => o.occursOn <= addDays(T, 50))).toBe(true);
    await expect(respondToRenewal(s.w.id, offer.id, "accept")).rejects.toThrow(/already answered/);
    expect((await db.select().from(notifications).where(eq(notifications.userId, s.b.id))).some((x) => x.title === "Renewal accepted")).toBe(true);
  });
  it("declining leaves the term and rate untouched; the business can propose again; withdrawal works", async () => {
    const s = await scenario({ endInDays: 20 });
    await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 50), newRate: 40 });
    await respondToRenewal(s.w.id, (await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, s.id)))[0].id, "decline");
    const a = (await db.select().from(assignments).where(eq(assignments.id, s.id)))[0]; expect(a.endDate).toBe(addDays(T, 20)); expect(a.agreedCents).toBe(3000);
    await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 40) });
    const pending = (await db.select().from(renewalOffers).where(and(eq(renewalOffers.assignmentId, s.id), eq(renewalOffers.status, "pending"))))[0];
    await withdrawRenewal(s.b.id, pending.id); await expect(respondToRenewal(s.w.id, pending.id, "accept")).rejects.toThrow(/already answered/);
    expect((await db.select().from(assignments).where(eq(assignments.id, s.id)))[0].endDate).toBe(addDays(T, 20));
  });
  it("an offer can't be accepted for a term that already ended", async () => {
    const s = await scenario({ endInDays: 20 }); await proposeRenewal(s.b.id, s.id, { newEndDate: addDays(T, 50) });
    const offer = (await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, s.id)))[0];
    await expect(respondToRenewal(s.w.id, offer.id, "accept", later(25))).rejects.toThrow(/already ended/);
  });
});

describe("renewal job", () => {
  it("expires offers on ended terms, reminds owners/managers (not members) once a week, and skips open-ended terms or those with an offer pending", async () => {
    const soon = await scenario({ endInDays: 10 }); const far = await scenario({ endInDays: 60 }); const open = await scenario({ endInDays: null }); const withOffer = await scenario({ endInDays: 9 });
    const mem = await member(soon.b.id);
    await proposeRenewal(withOffer.b.id, withOffer.id, { newEndDate: addDays(T, 40) });
    const r1 = await runRenewalJob();
    const titles = async (uid: string) => (await db.select().from(notifications).where(eq(notifications.userId, uid))).map((x) => x.title);
    expect((await titles(soon.b.id)).some((t) => t.startsWith("Term ending soon"))).toBe(true);
    expect((await titles(mem.id)).some((t) => t.startsWith("Term ending soon"))).toBe(false);
    for (const x of [far, open, withOffer]) expect((await titles(x.b.id)).some((t) => t.startsWith("Term ending soon"))).toBe(false);
    expect(r1.reminded).toBeGreaterThanOrEqual(1);
    await runRenewalJob(); expect((await titles(soon.b.id)).filter((t) => t.startsWith("Term ending soon"))).toHaveLength(1); // no daily nagging
    // term ends → pending offer expires
    await db.update(assignments).set({ endDate: addDays(T, -1) }).where(eq(assignments.id, withOffer.id));
    const r2 = await runRenewalJob(); expect(r2.expired).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(renewalOffers).where(eq(renewalOffers.assignmentId, withOffer.id)))[0].status).toBe("expired");
  });
});
