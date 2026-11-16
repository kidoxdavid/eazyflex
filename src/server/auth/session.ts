import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { hashToken, newToken } from "./tokens";
import { can, type AdminRole, type Permission } from "../rbac";

// "__Host-" cookies must be Secure, path=/ and have no Domain: they cannot be overwritten from a subdomain or over plain HTTP.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-oh_session" : "oh_session";
const TTL_DAYS = 30;
const ADMIN_TTL_HOURS = 8; // privileged sessions are short-lived

export async function createSession(userId: string, userAgent?: string | null, opts: { kind?: string; mfaVerified?: boolean } = {}) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + (opts.kind === "admin" ? ADMIN_TTL_HOURS * 3600_000 : TTL_DAYS * 86400_000));
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent ?? null, mfaVerifiedAt: opts.mfaVerified ? new Date() : null });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(COOKIE);
}

export type CurrentUser = typeof users.$inferSelect;

export const getSessionContext = cache(async (): Promise<{ user: CurrentUser; sessionId: string; mfaVerifiedAt: Date | null } | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users, sessionId: sessions.id, mfaVerifiedAt: sessions.mfaVerifiedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || r.user.status === "suspended" || r.user.status === "deleted") return null;
  return r;
});
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => (await getSessionContext())?.user ?? null);

/** Admins must pass a second factor. Required by default in production (MFA_ENFORCEMENT=required|optional); once enrolled it is always required. */
export const mfaEnforced = () => (process.env.MFA_ENFORCEMENT ? process.env.MFA_ENFORCEMENT === "required" : process.env.NODE_ENV === "production");

/** Server-side guards. Every protected page and action must call one of these. The MFA gate applies to every admin request. */
export const homeFor = (u: Pick<CurrentUser, "kind">) => (u.kind === "admin" ? "/admin" : u.kind === "business" ? "/business" : "/worker");

export async function requireUser(kind?: "worker" | "business" | "admin", opts: { skipMfa?: boolean } = {}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/sign-in");
  const u = ctx.user;
  if (u.kind === "admin" && !opts.skipMfa && (mfaEnforced() || u.totpEnabledAt) && !ctx.mfaVerifiedAt) redirect("/mfa");
  if (kind && u.kind !== kind) redirect(homeFor(u));
  return u;
}

export async function markCurrentSessionMfaVerified() {
  const ctx = await getSessionContext();
  if (ctx) await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, ctx.sessionId));
}

export async function requireAdmin(perm: Permission) {
  const u = await requireUser("admin");
  if (!can(u.adminRole as AdminRole, perm)) redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that (" + perm + ")."));
  return u;
}
