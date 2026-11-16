import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, mfaRecoveryCodes, sessions, users } from "@/server/db/schema";
import { beginEnrollment, checkSecondFactor, confirmEnrollment, mfaStatus, regenerateRecoveryCodes, resetMfa } from "@/server/services/mfa";
import { totp } from "@/server/auth/totp";
import type { Actor } from "@/server/services/admin";
import { closeDb, freshDb } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

let n = 0;
async function admin(role: NonNullable<Actor["adminRole"]> = "platform_admin") {
  const [u] = await db.insert(users).values({ email: `mfa${Date.now()}${n++}@admin.test`, passwordHash: "x", kind: "admin", adminRole: role, fullName: "Admin " + role, emailVerifiedAt: new Date() }).returning();
  return u;
}
async function enrolled() {
  const u = await admin(); const { secret } = await beginEnrollment(u.id);
  const codes = await confirmEnrollment(u.id, totp(secret));
  return { u, secret, codes };
}
const next = (secret: string, k = 1) => totp(secret, Date.now() + k * 30_000); // a later step than the one used for enrolment

describe("enrolment", () => {
  it("stores the seed encrypted, doesn't activate until a valid code is entered, and is resumable", async () => {
    const u = await admin(); const a = await beginEnrollment(u.id); const b = await beginEnrollment(u.id);
    expect(b.secret).toBe(a.secret); expect(a.uri).toContain(a.secret);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.totpSecretEnc).toBeTruthy(); expect(row.totpSecretEnc).not.toContain(a.secret); expect(row.totpEnabledAt).toBeNull();
    expect(await mfaStatus(u.id)).toMatchObject({ enrolled: false, pending: true });
    await expect(confirmEnrollment(u.id, "000000")).rejects.toThrow(/not valid/);
    await expect(confirmEnrollment(u.id, "abcdef")).rejects.toThrow(/not valid/);
    expect((await mfaStatus(u.id)).enrolled).toBe(false);
  });
  it("a valid code enables 2FA and returns 8 recovery codes stored only as hashes", async () => {
    const { u, codes } = await enrolled();
    expect(codes).toHaveLength(8); expect(new Set(codes).size).toBe(8); codes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/));
    const rows = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, u.id));
    expect(rows).toHaveLength(8); for (const r of rows) { expect(r.codeHash).toMatch(/^[a-f0-9]{64}$/); expect(codes).not.toContain(r.codeHash); }
    expect(await mfaStatus(u.id)).toMatchObject({ enrolled: true, recoveryCodesLeft: 8 });
    await expect(beginEnrollment(u.id)).rejects.toThrow(/already enabled/);
  });
  it("database refuses an 'enabled' account without a secret", async () => {
    const u = await admin(); await expect(db.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, u.id))).rejects.toThrow();
  });
});

describe("second factor at sign-in", () => {
  it("accepts a fresh code once; the same code can't be replayed; wrong codes fail and are audited", async () => {
    const { u, secret } = await enrolled();
    const code = next(secret); expect(await checkSecondFactor(u.id, code)).toBe("totp");
    await expect(checkSecondFactor(u.id, code)).rejects.toThrow(/not valid or was already used/);
    await expect(checkSecondFactor(u.id, totp(secret))).rejects.toThrow(); // an earlier step than the one already used
    await expect(checkSecondFactor(u.id, "123456")).rejects.toThrow();
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, u.id))).filter((l) => l.action === "mfa.failed").length).toBeGreaterThanOrEqual(2);
  });
  it("simultaneous use of one valid code succeeds exactly once", async () => {
    const { u, secret } = await enrolled(); const code = next(secret);
    const results = await Promise.allSettled([checkSecondFactor(u.id, code), checkSecondFactor(u.id, code), checkSecondFactor(u.id, code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("recovery codes work once each, ignoring case, spaces and dashes", async () => {
    const { u, codes } = await enrolled();
    expect(await checkSecondFactor(u.id, codes[0].toUpperCase().replace("-", " "))).toBe("recovery");
    await expect(checkSecondFactor(u.id, codes[0])).rejects.toThrow();
    expect(await checkSecondFactor(u.id, codes[1])).toBe("recovery");
    expect((await mfaStatus(u.id)).recoveryCodesLeft).toBe(6);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, u.id))).some((l) => l.action === "mfa.recovery_code_used")).toBe(true);
  });
  it("rate-limits guessing", async () => {
    const { u } = await enrolled(); let last: any;
    for (let i = 0; i < 10; i++) last = await checkSecondFactor(u.id, String(100000 + i)).catch((e) => e);
    expect(last.code).toBe("rate_limited");
  });
  it("a user without 2FA can't pass a challenge", async () => {
    const u = await admin(); await expect(checkSecondFactor(u.id, "123456")).rejects.toThrow(/not set up/);
  });
});

describe("recovery code regeneration and reset", () => {
  it("regenerating needs a valid TOTP and invalidates the old codes", async () => {
    const { u, secret, codes } = await enrolled();
    await expect(regenerateRecoveryCodes(u.id, "000000")).rejects.toThrow();
    await expect(regenerateRecoveryCodes(u.id, "abc")).rejects.toThrow(/6-digit/);
    const fresh = await regenerateRecoveryCodes(u.id, next(secret));
    expect(fresh).toHaveLength(8); await expect(checkSecondFactor(u.id, codes[0])).rejects.toThrow(); expect(await checkSecondFactor(u.id, fresh[0])).toBe("recovery");
  });
  it("only a super administrator can reset another admin's 2FA; it clears the seed and revokes sessions", async () => {
    const { u } = await enrolled(); await db.insert(sessions).values({ userId: u.id, tokenHash: "m".repeat(40) + u.id, expiresAt: new Date(Date.now() + 1e6) });
    const sa = await admin("super_admin"), pa = await admin("platform_admin");
    const as = (x: typeof sa): Actor => ({ id: x.id, kind: "admin", adminRole: x.adminRole });
    await expect(resetMfa(as(pa), u.id)).rejects.toThrow(/Forbidden/);
    await expect(resetMfa(as(sa), sa.id)).rejects.toThrow(/another super administrator/);
    await resetMfa(as(sa), u.id);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.totpSecretEnc).toBeNull(); expect(row.totpEnabledAt).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, u.id))).toHaveLength(0);
    expect((await mfaStatus(u.id)).enrolled).toBe(false);
  });
});
