import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { authTokens, businessMembers, businesses, sessions, userConsents, users, workerProfiles, verifications } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/password";
import { hashToken, newToken } from "../auth/tokens";
import { sendEmail } from "../email";
import { rateLimit } from "../rate-limit";
import { audit } from "../audit";
import { brand } from "@/lib/brand";

export class ServiceError extends Error {
  constructor(message: string, public code: "validation" | "conflict" | "forbidden" | "not_found" | "rate_limited" | "auth" = "validation") { super(message); }
}

const password = z.string().min(10, "Use at least 10 characters").max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Include letters and at least one number");

export const registerSchema = z.object({
  kind: z.enum(["worker", "business"]),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  postalPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]\d[A-Z]$/, "Enter the first three characters of your postal code, e.g. T2P").optional().or(z.literal("")),
  businessName: z.string().trim().min(2).max(160).optional(),
  businessKind: z.enum(["registered_business", "household"]).optional(),
  acceptTerms: z.literal(true, { message: "You must accept the Terms and Privacy Policy" }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

async function issueToken(userId: string, purpose: "email_verification" | "password_reset", hours: number) {
  const token = newToken();
  await db.insert(authTokens).values({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + hours * 3600_000) });
  return token;
}

export async function registerUser(raw: unknown) {
  const input = registerSchema.parse(raw);
  if (input.kind === "business" && !input.businessName) throw new ServiceError("Business or household name is required");
  const existing = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (existing.length) throw new ServiceError("An account with this email already exists", "conflict");
  const passwordHash = await hashPassword(input.password);

  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      email: input.email, passwordHash, kind: input.kind, fullName: input.fullName, phone: input.phone || null,
    }).returning();
    await tx.insert(userConsents).values([
      { userId: u.id, documentType: "terms", version: brand.policyVersions.terms },
      { userId: u.id, documentType: "privacy", version: brand.policyVersions.privacy },
    ]);
    await tx.insert(verifications).values({ userId: u.id, type: "email", status: "pending", provider: "email_link" });
    if (input.kind === "worker") {
      await tx.insert(workerProfiles).values({ userId: u.id, city: input.city || null, postalPrefix: input.postalPrefix || null });
    } else {
      const [b] = await tx.insert(businesses).values({
        name: input.businessName!, kind: input.businessKind ?? "registered_business", city: input.city || null, contactEmail: input.email,
      }).returning();
      await tx.insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "owner" });
    }
    await audit(u.id, "user.registered", "user", u.id, { kind: input.kind }, tx);
    return u;
  });

  const token = await issueToken(user.id, "email_verification", 48);
  await sendEmail({ to: user.email, template: "email_verification", subject: `Verify your email for ${brand.name}`, body: `Hi ${user.fullName}, confirm your email address to finish setting up your account.`, path: `/verify-email?token=${token}` });
  return user;
}

export async function verifyEmail(token: string) {
  const rows = await db.select().from(authTokens).where(and(
    eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.purpose, "email_verification"),
    isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).limit(1);
  const t = rows[0];
  if (!t) throw new ServiceError("This verification link is invalid or has expired", "not_found");
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
    await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, t.userId));
    await tx.update(verifications).set({ status: "verified", decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(verifications.userId, t.userId), eq(verifications.type, "email")));
    await audit(t.userId, "user.email_verified", "user", t.userId, undefined, tx);
  });
  return t.userId;
}

// Real hash computed once, so unknown-email logins cost the same as known ones.
const DUMMY_HASH = hashPassword("timing-equaliser-not-a-real-password");

export async function authenticate(emailRaw: string, pw: string, ip = "unknown") {
  const email = emailRaw.trim().toLowerCase();
  if (!(await rateLimit(`login:${email}`, 8, 900)) || !(await rateLimit(`login-ip:${ip}`, 30, 900)))
    throw new ServiceError("Too many attempts. Try again in a few minutes.", "rate_limited");
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const ok = await verifyPassword(u ? u.passwordHash : await DUMMY_HASH, pw);
  if (!u || !ok) throw new ServiceError("Incorrect email or password", "auth");
  if (u.status === "suspended" || u.status === "deleted") throw new ServiceError("This account is not active. Contact support.", "forbidden");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return u;
}

export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!(await rateLimit(`reset:${email}`, 3, 3600))) return; // silent: do not reveal anything
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!u || u.status !== "active") return; // identical response either way
  const token = await issueToken(u.id, "password_reset", 1);
  await sendEmail({ to: u.email, template: "password_reset", subject: `Reset your ${brand.name} password`, body: "Use the link to choose a new password. If you did not ask for this, ignore this email.", path: `/reset-password?token=${token}` });
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = password.parse(newPassword);
  const rows = await db.select().from(authTokens).where(and(
    eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.purpose, "password_reset"),
    isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).limit(1);
  const t = rows[0];
  if (!t) throw new ServiceError("This reset link is invalid or has expired", "not_found");
  const hash = await hashPassword(pw);
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
    await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, t.userId));
    await tx.delete(sessions).where(eq(sessions.userId, t.userId)); // sign out everywhere
    await audit(t.userId, "user.password_reset", "user", t.userId, undefined, tx);
  });
}
