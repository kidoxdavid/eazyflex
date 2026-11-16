import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { hashToken, newToken } from "./tokens";
import { can, type AdminRole, type Permission } from "../rbac";

const COOKIE = "oh_session";
const TTL_DAYS = 30;

export async function createSession(userId: string, userAgent?: string | null) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent ?? null });
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

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0]?.user;
  if (!u || u.status === "suspended" || u.status === "deleted") return null;
  return u;
});

/** Server-side guards. Every protected page and action must call one of these. */
export const homeFor = (u: Pick<CurrentUser, "kind">) => (u.kind === "admin" ? "/admin" : u.kind === "business" ? "/business" : "/worker");

export async function requireUser(kind?: "worker" | "business" | "admin") {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  if (kind && u.kind !== kind) redirect(homeFor(u));
  return u;
}

export async function requireAdmin(perm: Permission) {
  const u = await requireUser("admin");
  if (!can(u.adminRole as AdminRole, perm)) redirect("/admin?error=" + encodeURIComponent("You do not have permission to do that (" + perm + ")."));
  return u;
}
