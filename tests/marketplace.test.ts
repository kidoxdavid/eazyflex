import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { applications, auditLogs, matchingRules, notifications, opportunities, skills, users, workerProfiles } from "@/server/db/schema";
import { saveOpportunity, searchOpportunities, setOpportunityStatus } from "@/server/services/opportunities";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus, listWorkerApplications } from "@/server/services/applications";
import { getBusinessForUser, browseTalent } from "@/server/services/business";
import { saveAbout, savePreferences, saveAvailability, saveCompensation, completeOnboarding } from "@/server/services/worker";
import { matchWorkerToOpportunity, recommendForWorker, recommendWorkersForOpportunity } from "@/server/services/matching";
import { closeDb, freshDb, makeUser, ref } from "./helpers";
import { q } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

const base = (cat: string, o: Record<string, unknown> = {}) => ({
  title: "Weekly bookkeeping support", description: "Keep our books current by entering invoices and reconciling the bank feed each week.",
  engagementType: "micro_task", categoryId: cat, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, ...o,
});

async function setupWorker(skillNames = ["Excel"], windows = [{ weekday: 2, startMinute: 540, endMinute: 900 }]) {
  const w = await makeUser("worker");
  const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Spreadsheet specialist", summary: "I build and clean spreadsheets for small teams and love tidy data.", experienceLevel: "intermediate", skillIds: sk.filter((s) => skillNames.includes(s.name)).map((s) => s.id), languages: ["English"], portfolioLinks: [] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true });
  await saveCompensation(w.id, { preferredHourly: 35, minHourly: 25, minHourlyIsHard: false, willingToNegotiate: true });
  await saveAvailability(w.id, { windows, availabilityPaused: false });
  await completeOnboarding(w.id);
  return w;
}

describe("opportunity posting rules", () => {
  it("publishes a valid hourly posting and stores cents", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const r = await saveOpportunity(b.id, biz.id, base(cat.id), { publish: true });
    expect(r.status).toBe("published");
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, r.id));
    expect([o.payMinCents, o.payMaxCents]).toEqual([3000, 4000]);
  });
  it("rejects misleading or incomplete compensation", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { payMin: 50, payMax: 40 }), { publish: true })).rejects.toThrow(/lower than the minimum/);
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { payMin: undefined, payMax: undefined }), { publish: true })).rejects.toThrow();
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { engagementType: "fixed_project", payType: "fixed", payMin: 500, payMax: 600 }), { publish: true })).rejects.toThrow(/defined scope/);
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { engagementType: "fixed_project", payType: "hourly" }), { publish: true })).rejects.toThrow(/cannot use/);
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { arrangement: "local" }), { publish: true })).rejects.toThrow(/work area/);
    await expect(saveOpportunity(b.id, biz.id, base(cat.id, { engagementType: "recurring", payType: "recurring" }), { publish: true })).rejects.toThrow(/hours per week/);
  });
  it("routes regulated categories to review instead of publishing", async () => {
    const { regulatedCat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    expect((await saveOpportunity(b.id, biz.id, base(regulatedCat.id), { publish: true })).status).toBe("pending_review");
  });
  it("saves incomplete drafts without publishing them to search", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const d = await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Draft thing here ok" }), { publish: false });
    expect(d.status).toBe("draft");
    const res = await searchOpportunities({ q: "Draft thing" });
    expect(res.items.find((i) => i.o.id === d.id)).toBeUndefined();
  });
  it("a business cannot edit or post for another business", async () => {
    const { cat } = await ref();
    const a = await makeUser("business"); const b = await makeUser("business");
    const bizA = (await getBusinessForUser(a.id))!.b; const bizB = (await getBusinessForUser(b.id))!.b;
    await expect(saveOpportunity(b.id, bizA.id, base(cat.id), { publish: true })).rejects.toThrow(/do not have access/);
    const o = await saveOpportunity(a.id, bizA.id, base(cat.id), { publish: true });
    await expect(saveOpportunity(b.id, bizB.id, base(cat.id), { publish: true, id: o.id })).rejects.toThrow(/not found/i);
    await expect(setOpportunityStatus(b.id, bizB.id, o.id, "closed")).rejects.toThrow(/not found/i);
  });
  it("full-text search finds published opportunities", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Zanzibar spreadsheet wrangler" }), { publish: true });
    const r = await searchOpportunities({ q: "zanzibar" });
    expect(r.total).toBe(1);
  });
});

describe("application workflow and access control", () => {
  async function scenario() {
    const { cat } = await ref();
    const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const o = await saveOpportunity(b.id, biz.id, base(cat.id), { publish: true });
    const w = await makeUser("worker");
    return { b, biz, o, w };
  }
  it("requires a verified email to apply", async () => {
    const { o } = await scenario(); const w = await makeUser("worker", { verify: false });
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal: "x".repeat(40) })).rejects.toThrow(/Verify your email/);
  });
  it("submits, prevents duplicates, records history and notifies the business", async () => {
    const { o, w, b } = await scenario();
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    expect(a.status).toBe("submitted");
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience again." })).rejects.toThrow(/already applied/);
    expect((await db.select().from(notifications).where(eq(notifications.userId, b.id))).some((n) => n.type === "application_new")).toBe(true);
  });
  it("only the owning business can move an application; invalid transitions are refused", async () => {
    const { o, w, b } = await scenario(); const other = await makeUser("business");
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    await expect(businessSetApplicationStatus(other.id, a.id, "shortlisted")).rejects.toThrow(/not found/i);
    await businessSetApplicationStatus(b.id, a.id, "shortlisted");
    await expect(businessSetApplicationStatus(b.id, a.id, "under_review")).rejects.toThrow(/Cannot change/);
    await expect(workerSetApplicationStatus(w.id, a.id, "accepted")).rejects.toThrow(/Cannot change/); // no offer yet
  });
  it("another worker cannot withdraw someone else's application", async () => {
    const { o, w } = await scenario(); const intruder = await makeUser("worker");
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    await expect(workerSetApplicationStatus(intruder.id, a.id, "withdrawn")).rejects.toThrow(/not found/i);
    expect(await listWorkerApplications(intruder.id)).toHaveLength(0);
  });
  it("offer → accept fills the opportunity when workersNeeded is reached and blocks further acceptance", async () => {
    const { o, w, b } = await scenario(); const w2 = await makeUser("worker");
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    const a2 = await applyToOpportunity(w2.id, { opportunityId: o.id, proposal: "Also experienced with bookkeeping and invoicing workflows here." });
    await businessSetApplicationStatus(b.id, a.id, "offer_received");
    await businessSetApplicationStatus(b.id, a2.id, "offer_received");
    await workerSetApplicationStatus(w.id, a.id, "accepted");
    expect((await db.select().from(opportunities).where(eq(opportunities.id, o.id)))[0].status).toBe("filled");
    await expect(workerSetApplicationStatus(w2.id, a2.id, "accepted")).rejects.toThrow(/no longer open/);
  });
  it("withdrawn applications are terminal", async () => {
    const { o, w, b } = await scenario();
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    await workerSetApplicationStatus(w.id, a.id, "withdrawn");
    await expect(businessSetApplicationStatus(b.id, a.id, "shortlisted")).rejects.toThrow(/Cannot change/);
    await expect(workerSetApplicationStatus(w.id, a.id, "withdrawn")).rejects.toThrow(/Cannot change/);
  });
  it("cannot apply to closed or draft opportunities, or as a business", async () => {
    const { o, w, b, biz } = await scenario();
    await setOpportunityStatus(b.id, biz.id, o.id, "closed");
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." })).rejects.toThrow(/not open/);
    await expect(applyToOpportunity(b.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." })).rejects.toThrow(/Only workers/);
  });
});

describe("matching against the database", () => {
  it("recommends only opportunities whose real availability and mandatory skills fit", async () => {
    const { cat } = await ref();
    const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const sk = await db.select().from(skills); const excel = sk.find((s) => s.name === "Excel")!; const tutoring = sk.find((s) => s.name === "Bookkeeping support")!;
    const fit = await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Tuesday morning Excel help", skillIds: [excel.id], mandatorySkillIds: [excel.id], schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }] }), { publish: true });
    const wrongTime = await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Sunday night Excel help", skillIds: [excel.id], mandatorySkillIds: [excel.id], schedule: [{ weekday: 0, startMinute: 1200, endMinute: 1320 }] }), { publish: true });
    const wrongSkill = await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Bookkeeping Tuesday help", skillIds: [tutoring.id], mandatorySkillIds: [tutoring.id], schedule: [{ weekday: 2, startMinute: 600, endMinute: 720 }] }), { publish: true });
    const w = await setupWorker(["Excel"]);
    const recs = (await recommendForWorker(w.id)).map((r) => r.id);
    expect(recs).toContain(fit.id);
    expect(recs).not.toContain(wrongTime.id);
    expect(recs).not.toContain(wrongSkill.id);
    const m = await matchWorkerToOpportunity(w.id, wrongTime.id);
    expect(m.eligible).toBe(false);
    expect(m.explanation).toMatch(/Not available/);
  });
  it("does not recommend opportunities the worker already applied to", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const o = await saveOpportunity(b.id, biz.id, base(cat.id, { title: "Already applied job here" }), { publish: true });
    const w = await setupWorker();
    expect((await recommendForWorker(w.id)).map((r) => r.id)).toContain(o.id);
    await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start now." });
    expect((await recommendForWorker(w.id)).map((r) => r.id)).not.toContain(o.id);
  });
  it("active matching rules are versioned in the database and drive the result", async () => {
    const rules = await db.select().from(matchingRules);
    expect(rules.filter((r) => r.active)).toHaveLength(1);
    await expect(q("insert into matching_rules (version, weights, thresholds, active) values (999, '{}', '{}', true)")).rejects.toThrow(); // single active rule enforced by index
  });
});

describe("talent privacy", () => {
  it("exposes only first name + initial, never email/phone, and only opted-in, onboarded workers", async () => {
    const w = await setupWorker(); const hidden = await setupWorker();
    await db.update(workerProfiles).set({ publicProfile: false }).where(eq(workerProfiles.userId, hidden.id));
    await db.update(users).set({ phone: "403-555-0100" }).where(eq(users.id, w.id));
    const b = await makeUser("business");
    const list = await browseTalent(b.id, {});
    const me = list.find((t) => t.workerId === w.id)!;
    expect(me).toBeTruthy();
    expect(list.find((t) => t.workerId === hidden.id)).toBeUndefined();
    expect(JSON.stringify(list)).not.toMatch(/403-555-0100|@test\.example/);
    expect(me.displayName).toBe("Test W.");
    expect(me.verified).toEqual(["email"]); // only what is truly verified
  });
  it("workers cannot browse talent (business-only)", async () => {
    const w = await makeUser("worker");
    await expect(browseTalent(w.id, {})).rejects.toThrow(/No business account/);
  });
  it("recommended workers for another business's opportunity are not leaked", async () => {
    const { cat } = await ref(); const a = await makeUser("business"); const bb = await makeUser("business");
    const bizA = (await getBusinessForUser(a.id))!.b; const bizB = (await getBusinessForUser(bb.id))!.b;
    const o = await saveOpportunity(a.id, bizA.id, base(cat.id), { publish: true });
    await expect(recommendWorkersForOpportunity(bb.id, bizA.id, o.id)).rejects.toThrow(/do not have access/);
    expect(await recommendWorkersForOpportunity(bb.id, bizB.id, o.id)).toEqual([]);
  });
});

describe("audit log immutability", () => {
  it("cannot be updated, deleted or truncated", async () => {
    const [row] = await db.select().from(auditLogs).limit(1);
    await expect(q(`update audit_logs set action='x' where id='${row.id}'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from audit_logs where id='${row.id}'`)).rejects.toThrow(/append-only/);
    await expect(q("truncate audit_logs")).rejects.toThrow(/append-only/);
  });
});

describe("transactions", () => {
  it("roll back atomically and release their connection", async () => {
    const before = await db.select().from(auditLogs);
    await expect(db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({ action: "tx.test", entityType: "test" });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect((await db.select().from(auditLogs)).length).toBe(before.length);
    const pool = (await import("@/server/db/client")).getPool();
    expect(pool.totalCount - pool.idleCount).toBe(0); // nothing left checked out
  });
});
