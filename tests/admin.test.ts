import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, matchingRules, opportunities, sessions, users, verifications } from "@/server/db/schema";
import { decideVerification, listUsers, moderateOpportunity, publishMatchingRules, setUserStatus, upsertCategory, type Actor } from "@/server/services/admin";
import { loadActiveRules } from "@/server/services/matching";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser, submitBusinessVerification } from "@/server/services/business";
import { ADMIN_ROLES, can } from "@/server/rbac";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);
const admin = (role: Actor["adminRole"]): Actor => ({ id: crypto.randomUUID(), kind: "admin", adminRole: role });
async function realAdmin(role: NonNullable<Actor["adminRole"]>) {
  const [u] = await db.insert(users).values({ email: `${role}.${Date.now()}@admin.test`, passwordHash: "x", kind: "admin", adminRole: role, fullName: role, emailVerifiedAt: new Date() }).returning();
  return { id: u.id, kind: "admin", adminRole: role } as Actor;
}
const rules = { weights: { skills: 40, availability: 20, location: 10, arrangement: 5, compensation: 10, experience: 5, duration: 5, preferences: 5 }, thresholds: { recommend: 55, strong: 85 }, mandatory: ["skills", "availability"] };

describe("role permission matrix", () => {
  it("least privilege: only super/platform admins configure matching; only super admin manages admins; finance cannot moderate", () => {
    expect(ADMIN_ROLES).toHaveLength(7);
    expect(can("platform_admin", "matching.configure")).toBe(true);
    expect(can("finance_admin", "matching.configure")).toBe(false);
    expect(can("support_agent", "users.suspend")).toBe(false);
    expect(can("platform_admin", "admins.manage")).toBe(false);
    expect(can("super_admin", "admins.manage")).toBe(true);
    expect(can("read_only_analyst", "opportunities.moderate")).toBe(false);
    expect(can("finance_admin", "finance.configure")).toBe(true);
    expect(can("platform_admin", "finance.configure")).toBe(false); // financial config is not automatically granted
    expect(can(null, "dashboard.view")).toBe(false);
  });
  it("services enforce permissions themselves, regardless of the UI", async () => {
    const worker = await makeUser("worker");
    await expect(listUsers({ id: worker.id, kind: "worker", adminRole: null })).rejects.toThrow(/Forbidden/);
    await expect(listUsers(admin("finance_admin"))).rejects.toThrow(/Forbidden/);
    await expect(setUserStatus(admin("support_agent"), worker.id, "suspended", "x")).rejects.toThrow(/Forbidden/);
    await expect(publishMatchingRules(admin("content_moderator"), rules)).rejects.toThrow(/Forbidden/);
    await expect(upsertCategory(admin("read_only_analyst"), { name: "Nope" })).rejects.toThrow(/Forbidden/);
  });
  it("user listing never exposes password hashes", async () => {
    const a = await realAdmin("support_agent");
    const rows = await listUsers(a);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/passwordHash|argon2/);
  });
});

describe("user suspension", () => {
  it("requires a reason, revokes sessions, writes audit, and is reversible", async () => {
    const a = await realAdmin("platform_admin"); const w = await makeUser("worker");
    await db.insert(sessions).values({ userId: w.id, tokenHash: "s".repeat(40) + w.id, expiresAt: new Date(Date.now() + 1e6) });
    await expect(setUserStatus(a, w.id, "suspended", "  ")).rejects.toThrow(/reason is required/);
    await setUserStatus(a, w.id, "suspended", "Policy violation");
    expect((await db.select().from(users).where(eq(users.id, w.id)))[0].status).toBe("suspended");
    expect(await db.select().from(sessions).where(eq(sessions.userId, w.id))).toHaveLength(0);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "user.suspended"), eq(auditLogs.entityId, w.id)))).length).toBe(1);
    await setUserStatus(a, w.id, "active", "Appeal upheld");
    expect((await db.select().from(users).where(eq(users.id, w.id)))[0].status).toBe("active");
  });
  it("cannot suspend yourself; only super admins may change another admin", async () => {
    const a = await realAdmin("platform_admin"); const other = await realAdmin("support_agent"); const sa = await realAdmin("super_admin");
    await expect(setUserStatus(a, a.id, "suspended", "x")).rejects.toThrow(/own account/);
    await expect(setUserStatus(a, other.id, "suspended", "x")).rejects.toThrow(/super administrator/);
    await setUserStatus(sa, other.id, "suspended", "rotation");
  });
});

describe("moderation, verification, configuration", () => {
  it("moderator approves/rejects pending opportunities; rejection needs a reason; actions are audited", async () => {
    const { regulatedCat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    const o = await saveOpportunity(b.id, biz.id, { title: "Maths tutoring for teens", description: "Weekly one-hour maths tutoring sessions for two high-school students at their home.", engagementType: "micro_task", categoryId: regulatedCat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
    expect(o.status).toBe("pending_review");
    const mod = await realAdmin("content_moderator");
    await expect(moderateOpportunity(mod, o.id, "reject")).rejects.toThrow(/Explain why/);
    await moderateOpportunity(mod, o.id, "approve");
    expect((await db.select().from(opportunities).where(eq(opportunities.id, o.id)))[0].status).toBe("published");
    await expect(moderateOpportunity(mod, o.id, "approve")).rejects.toThrow(/pending review/);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, o.id))).some((l) => l.action === "opportunity.approve")).toBe(true);
  });
  it("business verification: submit → only a verification officer can verify, and the badge follows the decision", async () => {
    const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b;
    await expect(submitBusinessVerification(b.id, biz.id, "short")).rejects.toThrow();
    await submitBusinessVerification(b.id, biz.id, "Alberta corporate registry entry and company website");
    expect((await getBusinessForUser(b.id))!.b.verificationStatus).toBe("submitted"); // not "verified" until decided
    const [v] = await db.select().from(verifications).where(eq(verifications.businessId, biz.id));
    await expect(decideVerification(await realAdmin("support_agent"), v.id, "verified")).rejects.toThrow(/Forbidden/);
    await decideVerification(await realAdmin("verification_officer"), v.id, "verified", "Registry matched");
    expect((await getBusinessForUser(b.id))!.b.verificationStatus).toBe("verified");
  });
  it("email verification cannot be set manually by an admin", async () => {
    const w = await makeUser("worker");
    const [v] = await db.select().from(verifications).where(and(eq(verifications.userId, w.id), eq(verifications.type, "email")));
    await expect(decideVerification(await realAdmin("verification_officer"), v.id, "rejected")).rejects.toThrow(/automatic/);
  });
  it("matching rules are versioned: publishing creates a new active version and keeps history", async () => {
    const before = await db.select().from(matchingRules);
    const a = await realAdmin("platform_admin");
    const row = await publishMatchingRules(a, rules);
    expect(row.version).toBe(before.length + 1);
    const all = await db.select().from(matchingRules);
    expect(all.filter((r) => r.active)).toHaveLength(1);
    expect(all).toHaveLength(before.length + 1);
    const active = await loadActiveRules();
    expect(active.version).toBe(row.version); expect(active.weights.skills).toBe(40); expect(active.thresholds.recommend).toBe(55);
  });
  it("rejects invalid rules (threshold order, all-zero weights)", async () => {
    const a = await realAdmin("platform_admin");
    await expect(publishMatchingRules(a, { ...rules, thresholds: { recommend: 90, strong: 50 } })).rejects.toThrow();
    await expect(publishMatchingRules(a, { ...rules, weights: Object.fromEntries(Object.keys(rules.weights).map((k) => [k, 0])) })).rejects.toThrow();
  });
});
