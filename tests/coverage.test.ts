import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { coverageSlices, handoverNotes, notifications, skills } from "@/server/db/schema";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding } from "@/server/services/worker";
import { acknowledgeHandover, addHandover, getCoverageView, listWorkerCoverage, proposeSlices, releaseSlice, respondToSlice, suggest } from "@/server/services/coverage";
import { startConversation } from "@/server/services/messaging";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

const H = (h: number) => h * 60;
const slicesOf = (opportunityId: string) => db.select().from(coverageSlices).where(eq(coverageSlices.opportunityId, opportunityId));
const notesOf = (opportunityId: string) => db.select().from(handoverNotes).where(eq(handoverNotes.opportunityId, opportunityId));
const SCHED = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: H(9), endMinute: H(15) })); // 30 h/week
async function worker(windows: { weekday: number; s: number; e: number }[], opts: { max?: number; skill?: string; paused?: boolean; publicProfile?: boolean } = {}) {
  const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Support agent", summary: "Experienced customer support agent working part-time around family life.", experienceLevel: "intermediate", skillIds: [sk.find((s) => s.name === (opts.skill ?? "Customer support"))!.id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: opts.publicProfile ?? true });
  await saveAvailability(w.id, { windows: windows.map((x) => ({ weekday: x.weekday, startMinute: H(x.s), endMinute: H(x.e) })), maxHoursPerWeek: opts.max ?? "", availabilityPaused: opts.paused ?? false });
  await completeOnboarding(w.id); return w;
}
async function requirement(extra: Record<string, unknown> = {}) {
  const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const sk = await db.select().from(skills);
  const cs = sk.find((s) => s.name === "Customer support")!;
  const o = await saveOpportunity(b.id, biz.id, { title: "Shared customer support desk", description: "Thirty hours a week of customer support, shared between several people covering set hours.", engagementType: "recurring", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 25, payMax: 30, hoursPerWeek: 30, recurrenceNote: "Weekly, ongoing", skillIds: [cs.id], mandatorySkillIds: [cs.id], schedule: SCHED, ...extra }, { publish: true });
  return { b, biz, o };
}
const four = async () => [
  await worker([{ weekday: 1, s: 9, e: 15 }, { weekday: 2, s: 9, e: 15 }], { max: 12 }),
  await worker([{ weekday: 3, s: 9, e: 15 }, { weekday: 4, s: 9, e: 12 }], { max: 10 }),
  await worker([{ weekday: 4, s: 12, e: 15 }, { weekday: 5, s: 9, e: 12 }], { max: 10 }),
  await worker([{ weekday: 5, s: 12, e: 15 }], { max: 5 }),
];

describe("work-sharing: suggest, propose, confirm", () => {
  it("covers a 30 h/week requirement with four part-time workers — nobody is booked until they confirm", async () => {
    const { b, o } = await requirement(); const ws = await four();
    const s = await suggest(b.id, o.id);
    expect(s.remainingGaps).toEqual([]); expect(new Set(s.suggestions.map((x) => x.workerId))).toEqual(new Set(ws.map((w) => w.id)));
    expect(s.suggestions.every((x) => x.explanation.length > 0 && x.workerName.endsWith("."))).toBe(true); // explained, privacy-preserving names
    expect(await slicesOf(o.id)).toHaveLength(0); // suggest is a preview only
    await proposeSlices(b.id, o.id, s.suggestions);
    let v = await getCoverageView(b.id, o.id);
    expect(v.report.percentConfirmed).toBe(0); expect(v.report.plannedGaps).toEqual([]); expect(v.report.complete).toBe(false);
    for (const w of ws) { const mine = await listWorkerCoverage(w.id); for (const it of mine.items) await respondToSlice(w.id, it.s.id, "confirm"); }
    v = await getCoverageView(b.id, o.id);
    expect(v.report.complete).toBe(true); expect(v.report.percentConfirmed).toBe(100); expect(v.report.overlaps).toEqual([]);
    expect((await db.select().from(notifications).where(eq(notifications.userId, b.id))).some((n) => n.title === "Coverage complete")).toBe(true);
  });
  it("only proposes workers who are discoverable, active, have required skills and haven't paused availability", async () => {
    const { b, o } = await requirement(); const good = await worker([{ weekday: 1, s: 9, e: 15 }]);
    const paused = await worker([{ weekday: 2, s: 9, e: 15 }], { paused: true }); const hidden = await worker([{ weekday: 3, s: 9, e: 15 }], { publicProfile: false });
    const wrongSkill = await worker([{ weekday: 4, s: 9, e: 15 }], { skill: "Photography" });
    const s = await suggest(b.id, o.id);
    expect(new Set(s.suggestions.map((x) => x.workerId))).toEqual(new Set([good.id]));
    for (const bad of [paused, hidden, wrongSkill]) await expect(proposeSlices(b.id, o.id, [{ workerId: bad.id, weekday: 5, startMinute: H(9), endMinute: H(10) }])).rejects.toThrow(/not available to be proposed/);
  });
  it("rejects proposals outside the required hours, overlapping existing slices, or invalid windows", async () => {
    const { b, o } = await requirement(); const [w1, w2] = await four();
    await expect(proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(14), endMinute: H(17) }])).rejects.toThrow(/outside the hours/);
    await expect(proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 6, startMinute: H(9), endMinute: H(10) }])).rejects.toThrow(/outside the hours/);
    await expect(proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(10), endMinute: H(10) }])).rejects.toThrow(/Invalid/);
    await proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(12) }]);
    await expect(proposeSlices(b.id, o.id, [{ workerId: w2.id, weekday: 1, startMinute: H(11), endMinute: H(13) }])).rejects.toThrow(/overlaps/);
    await expect(proposeSlices(b.id, o.id, [])).rejects.toThrow(/at least one/);
    expect(await slicesOf(o.id)).toHaveLength(1);
  });
  it("is atomic: if any slice in a batch is invalid, none are stored", async () => {
    const { b, o } = await requirement(); const [w1] = await four();
    await expect(proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(10) }, { workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(11) }])).rejects.toThrow(/overlaps/);
    expect(await slicesOf(o.id)).toHaveLength(0);
  });
});

describe("never booked beyond availability without explicit agreement", () => {
  it("a slice outside stated availability is flagged and can be confirmed only with explicit acknowledgement", async () => {
    const { b, o } = await requirement(); const w = await worker([{ weekday: 1, s: 9, e: 12 }]);
    await proposeSlices(b.id, o.id, [{ workerId: w.id, weekday: 1, startMinute: H(12), endMinute: H(15) }]);
    const item = (await listWorkerCoverage(w.id)).items[0]; expect(item.outside).toBe(true);
    await expect(respondToSlice(w.id, item.s.id, "confirm")).rejects.toThrow(/outside your stated availability/);
    expect((await slicesOf(o.id))[0].status).toBe("proposed");
    await respondToSlice(w.id, item.s.id, "confirm", true);
    const row = (await slicesOf(o.id))[0]; expect(row.status).toBe("confirmed"); expect(row.agreedOutside).toBe(true);
  });
  it("exceeding the weekly maximum also requires acknowledgement", async () => {
    const { b, o } = await requirement(); const w = await worker([{ weekday: 1, s: 9, e: 15 }, { weekday: 2, s: 9, e: 15 }], { max: 8 });
    await proposeSlices(b.id, o.id, [{ workerId: w.id, weekday: 1, startMinute: H(9), endMinute: H(15) }, { workerId: w.id, weekday: 2, startMinute: H(9), endMinute: H(15) }]);
    const [a, c] = (await listWorkerCoverage(w.id)).items;
    await respondToSlice(w.id, a.s.id, "confirm"); // 6 h of 8 h
    await expect(respondToSlice(w.id, c.s.id, "confirm")).rejects.toThrow(/weekly maximum/);
    await respondToSlice(w.id, c.s.id, "confirm", true);
  });
  it("declining books nothing and reopens the gap", async () => {
    const { b, o } = await requirement(); const [w1] = await four();
    await proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(15) }]);
    await respondToSlice(w1.id, (await listWorkerCoverage(w1.id)).items[0].s.id, "decline");
    const v = await getCoverageView(b.id, o.id); expect(v.report.confirmedMinutes).toBe(0); expect(v.report.plannedMinutes).toBe(0);
    expect((await listWorkerCoverage(w1.id)).items).toEqual([]);
  });
});

describe("clash detection across opportunities", () => {
  it("rejects proposing a time the worker is already confirmed for elsewhere", async () => {
    const A = await requirement(); const B = await requirement(); const w = await worker([{ weekday: 1, s: 9, e: 15 }]);
    await proposeSlices(A.b.id, A.o.id, [{ workerId: w.id, weekday: 1, startMinute: H(9), endMinute: H(12) }]);
    await respondToSlice(w.id, (await listWorkerCoverage(w.id)).items[0].s.id, "confirm");
    await expect(proposeSlices(B.b.id, B.o.id, [{ workerId: w.id, weekday: 1, startMinute: H(11), endMinute: H(13) }])).rejects.toThrow(/already committed elsewhere/);
    await proposeSlices(B.b.id, B.o.id, [{ workerId: w.id, weekday: 1, startMinute: H(12), endMinute: H(15) }]); // adjacent is fine
  });
  it("re-checks at confirmation time: two pending proposals that clash cannot both be confirmed", async () => {
    const A = await requirement(); const B = await requirement(); const w = await worker([{ weekday: 2, s: 9, e: 15 }]);
    await proposeSlices(A.b.id, A.o.id, [{ workerId: w.id, weekday: 2, startMinute: H(9), endMinute: H(12) }]);
    await proposeSlices(B.b.id, B.o.id, [{ workerId: w.id, weekday: 2, startMinute: H(10), endMinute: H(13) }]);
    const items = (await listWorkerCoverage(w.id)).items; expect(items.every((i) => i.s.status === "proposed")).toBe(true);
    await respondToSlice(w.id, items.find((i) => i.oppId === A.o.id)!.s.id, "confirm");
    await expect(respondToSlice(w.id, items.find((i) => i.oppId === B.o.id)!.s.id, "confirm", true)).rejects.toThrow(/already have a confirmed slice/); // acknowledgement cannot override a real clash
    expect((await listWorkerCoverage(w.id)).items.find((i) => i.oppId === B.o.id)!.clash).toBeTruthy();
  });
});

describe("access control", () => {
  it("other businesses and other workers cannot see or change coverage", async () => {
    const A = await requirement(); const other = await requirement(); const [w1, w2] = await four();
    await proposeSlices(A.b.id, A.o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(12) }]);
    const slice = (await slicesOf(A.o.id))[0];
    await expect(getCoverageView(other.b.id, A.o.id)).rejects.toThrow(/not found/i);
    await expect(suggest(other.b.id, A.o.id)).rejects.toThrow(/not found/i);
    await expect(proposeSlices(other.b.id, A.o.id, [{ workerId: w1.id, weekday: 2, startMinute: H(9), endMinute: H(10) }])).rejects.toThrow(/not found/i);
    await expect(releaseSlice(other.b.id, slice.id, "not yours to release")).rejects.toThrow(/not found/i);
    await expect(respondToSlice(w2.id, slice.id, "confirm")).rejects.toThrow(/not found/i);
    await expect(releaseSlice(w2.id, slice.id, "not my slice at all")).rejects.toThrow(/not found/i);
  });
  it("a worker with a coverage slice can message that business (relationship exists), a stranger cannot", async () => {
    const A = await requirement(); const [w1, w2] = await four();
    await expect(startConversation(A.b.id, w1.id)).rejects.toThrow(/once there is an application/);
    await proposeSlices(A.b.id, A.o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(12) }]);
    await startConversation(A.b.id, w1.id); await expect(startConversation(A.b.id, w2.id)).rejects.toThrow();
  });
});

describe("release and handovers", () => {
  async function confirmedPair() {
    const { b, o } = await requirement(); const [w1, w2] = await four();
    await proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(12) }]);
    // w2 is not available Monday: propose anyway (outside availability) and let them agree explicitly
    await proposeSlices(b.id, o.id, [{ workerId: w2.id, weekday: 1, startMinute: H(12), endMinute: H(15) }]);
    for (const w of [w1, w2]) for (const it of (await listWorkerCoverage(w.id)).items) await respondToSlice(w.id, it.s.id, "confirm", true);
    return { b, o, w1, w2 };
  }
  it("release needs a reason; either side can release; the gap reopens and the other party is told", async () => {
    const { b, o, w1 } = await confirmedPair();
    const mine = (await listWorkerCoverage(w1.id)).items[0];
    await expect(releaseSlice(w1.id, mine.s.id, "no")).rejects.toThrow(/short reason/);
    await releaseSlice(w1.id, mine.s.id, "Childcare fell through this week");
    const v = await getCoverageView(b.id, o.id); expect(v.report.confirmedGaps.some((g) => g.weekday === 1 && g.startMinute === H(9))).toBe(true);
    expect((await db.select().from(notifications).where(eq(notifications.userId, b.id))).some((n) => n.title === "A worker released a slice")).toBe(true);
    await expect(releaseSlice(w1.id, mine.s.id, "again please")).rejects.toThrow(/already closed/);
  });
  it("handover notes: only the outgoing worker or the business writes; only the incoming worker acknowledges; adjacency enforced", async () => {
    const { b, o, w1, w2 } = await confirmedPair(); const stranger = (await four())[3];
    const v = await getCoverageView(b.id, o.id); expect(v.handovers).toHaveLength(1);
    const { from, to } = v.handovers[0];
    await expect(addHandover(stranger.id, from.id, to.id, "I am not involved here")).rejects.toThrow(/not found/i);
    await expect(addHandover(w2.id, from.id, to.id, "Incoming worker cannot write the outgoing note")).rejects.toThrow(/not found/i);
    await expect(addHandover(w1.id, from.id, to.id, "no")).rejects.toThrow(/short handover note/);
    await addHandover(w1.id, from.id, to.id, "Ticket 4411 is waiting on the customer; two refunds pending approval.");
    await expect(addHandover(w1.id, from.id, to.id, "A second note for the same handover")).rejects.toThrow(/already exists/);
    const note = (await notesOf(o.id))[0];
    await expect(acknowledgeHandover(w1.id, note.id)).rejects.toThrow(/not found/i);
    await acknowledgeHandover(w2.id, note.id);
    expect((await notesOf(o.id))[0].acknowledgedAt).not.toBeNull();
    const view = await getCoverageView(b.id, o.id); expect(view.handovers[0].note?.acknowledgedAt).toBeTruthy();
    expect((await listWorkerCoverage(w2.id)).handovers[0].direction).toBe("incoming");
  });
  it("non-consecutive slices cannot be linked as a handover", async () => {
    const { b, o } = await requirement(); const [w1, w2] = await four();
    await proposeSlices(b.id, o.id, [{ workerId: w1.id, weekday: 1, startMinute: H(9), endMinute: H(11) }, { workerId: w2.id, weekday: 1, startMinute: H(12), endMinute: H(14) }]);
    for (const w of [w1, w2]) for (const it of (await listWorkerCoverage(w.id)).items) await respondToSlice(w.id, it.s.id, "confirm", true);
    const [a, c] = await slicesOf(o.id);
    await expect(addHandover(b.id, a.id, c.id, "A one-hour gap sits between these")).rejects.toThrow(/not consecutive/);
  });
});
