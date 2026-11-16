"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, markCurrentSessionMfaVerified } from "@/server/auth/session";
import { run, str } from "./util";
import * as M from "@/server/services/mfa";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { Actor } from "@/server/services/admin";

const RC = "oh_recovery";
/** One-time hand-off of recovery codes to the next page via a short-lived, httpOnly, encrypted cookie (never put them in a URL). */
const stash = async (codes: string[]) => (await cookies()).set(RC, encryptSecret(JSON.stringify(codes)), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/mfa", maxAge: 300 });
/** Read-only (pages can't modify cookies). The codes stay visible until the user clicks "continue" or 5 minutes pass. */
export async function peekRecoveryCodes(): Promise<string[] | null> {
  const v = (await cookies()).get(RC)?.value; if (!v) return null;
  try { return JSON.parse(decryptSecret(v)); } catch { return null; }
}
export async function ackRecoveryCodesAction() { (await cookies()).delete({ name: RC, path: "/mfa" }); redirect("/admin"); }

export async function confirmEnrollmentAction(f: FormData) {
  const u = await requireUser("admin", { skipMfa: true });
  await run(async () => { await stash(await M.confirmEnrollment(u.id, str(f, "code") ?? "")); await markCurrentSessionMfaVerified(); return "/mfa/recovery-codes"; }, "/mfa");
}
export async function challengeAction(f: FormData) {
  const u = await requireUser("admin", { skipMfa: true });
  await run(async () => { await M.checkSecondFactor(u.id, str(f, "code") ?? ""); await markCurrentSessionMfaVerified(); return "/admin"; }, "/mfa");
}
export async function regenerateCodesAction(f: FormData) {
  const u = await requireUser("admin");
  await run(async () => { await stash(await M.regenerateRecoveryCodes(u.id, str(f, "code") ?? "")); return "/mfa/recovery-codes"; }, "/mfa");
}
export async function resetMfaAction(f: FormData) {
  const u = await requireUser("admin"); const a: Actor = { id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] };
  await run(() => M.resetMfa(a, str(f, "userId") ?? ""), "/admin/users", "Two-factor authentication reset. They must enrol again at next sign-in.");
}
export async function skipForNowAction() { redirect("/admin"); }
