import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { mfaRecoveryCodes, sessions, users } from "../db/schema";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { rateLimit, rateLimitAllowed } from "../rate-limit";
import { newSecret, otpauthUri, verifyTotp } from "../auth/totp";
import { assertCan, type Actor } from "./admin";
import { ServiceError } from "./identity";
import { brand } from "@/lib/brand";

const norm = (c: string) => c.replace(/[\s-]/g, "").toLowerCase();
const hashCode = (c: string) => createHash("sha256").update(norm(c)).digest("hex");
const newRecovery = () => { const r = randomBytes(10).toString("hex").slice(0, 10); return `${r.slice(0, 5)}-${r.slice(5)}`; };

export async function mfaStatus(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new ServiceError("User not found", "not_found");
  const unused = u.totpEnabledAt ? (await db.select().from(mfaRecoveryCodes).where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)))).length : 0;
  return { enrolled: !!u.totpEnabledAt, pending: !!u.totpSecretEnc && !u.totpEnabledAt, recoveryCodesLeft: unused, email: u.email };
}

/** Begin (or resume) enrolment. The seed is stored encrypted and is not active until a valid code proves the authenticator works. */
export async function beginEnrollment(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new ServiceError("User not found", "not_found");
  if (u.totpEnabledAt) throw new ServiceError("Two-factor authentication is already enabled");
  const secret = u.totpSecretEnc ? decryptSecret(u.totpSecretEnc) : newSecret();
  if (!u.totpSecretEnc) await db.update(users).set({ totpSecretEnc: encryptSecret(secret), updatedAt: new Date() }).where(eq(users.id, userId));
  return { secret, uri: otpauthUri(u.email, secret, brand.name) };
}

async function issueRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 8 }, newRecovery);
  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.insert(mfaRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashCode(c) })));
  });
  return codes; // shown to the user once; only hashes are stored
}

export async function confirmEnrollment(userId: string, code: string) {
  if (!(await rateLimitAllowed(`mfa:${userId}`, 8, 600))) throw new ServiceError("Too many attempts. Wait a few minutes.", "rate_limited");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.totpSecretEnc) throw new ServiceError("Start enrolment first");
  if (u.totpEnabledAt) throw new ServiceError("Two-factor authentication is already enabled");
  const step = verifyTotp(decryptSecret(u.totpSecretEnc), code.trim());
  if (step === null) { await rateLimit(`mfa:${userId}`, 8, 600); throw new ServiceError("That code is not valid. Check your authenticator app and your device’s clock."); }
  await db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step, updatedAt: new Date() }).where(eq(users.id, userId));
  const codes = await issueRecoveryCodes(userId);
  await audit(userId, "mfa.enrolled", "user", userId);
  return codes;
}

/** Second factor at sign-in: a TOTP code (each 30 s step usable once) or a one-time recovery code. */
export async function checkSecondFactor(userId: string, input: string): Promise<"totp" | "recovery"> {
  if (!(await rateLimitAllowed(`mfa:${userId}`, 8, 600))) throw new ServiceError("Too many attempts. Wait a few minutes.", "rate_limited");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.totpEnabledAt || !u.totpSecretEnc) throw new ServiceError("Two-factor authentication is not set up");
  const code = input.trim();
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(decryptSecret(u.totpSecretEnc), code);
    if (step !== null && (u.totpLastStep === null || u.totpLastStep < step)) {
      // Atomic compare-and-set on the last accepted step: of any simultaneous requests carrying the same code, exactly one wins.
      const cond = u.totpLastStep === null ? isNull(users.totpLastStep) : eq(users.totpLastStep, u.totpLastStep);
      const won = await db.update(users).set({ totpLastStep: step }).where(and(eq(users.id, userId), cond)).returning({ id: users.id });
      if (won.length) { await audit(userId, "mfa.verified", "user", userId, { method: "totp" }); return "totp"; }
    }
  } else {
    const claimed = await db.update(mfaRecoveryCodes).set({ usedAt: new Date() }).where(and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.codeHash, hashCode(code)), isNull(mfaRecoveryCodes.usedAt))).returning({ id: mfaRecoveryCodes.id });
    if (claimed.length) { await audit(userId, "mfa.recovery_code_used", "user", userId); return "recovery"; }
  }
  await rateLimit(`mfa:${userId}`, 8, 600); // failures only
  await audit(userId, "mfa.failed", "user", userId);
  throw new ServiceError("That code is not valid or was already used.", "auth");
}

export async function regenerateRecoveryCodes(userId: string, totpCode: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.totpEnabledAt) throw new ServiceError("Two-factor authentication is not enabled");
  if (!/^\d{6}$/.test(totpCode.trim())) throw new ServiceError("Enter the 6-digit code from your authenticator app");
  await checkSecondFactor(userId, totpCode);
  const codes = await issueRecoveryCodes(userId);
  await audit(userId, "mfa.recovery_codes_regenerated", "user", userId);
  return codes;
}

/** Lost device: a super administrator clears another admin's second factor, revoking their sessions. They must re-enrol at next sign-in. */
export async function resetMfa(actor: Actor, targetUserId: string) {
  assertCan(actor, "admins.manage");
  if (targetUserId === actor.id) throw new ServiceError("Use another super administrator to reset your own two-factor authentication");
  const [t] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!t || t.kind !== "admin") throw new ServiceError("Administrator not found", "not_found");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, targetUserId));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, targetUserId));
    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));
    await audit(actor.id, "mfa.reset", "user", targetUserId, undefined, tx);
  });
}
