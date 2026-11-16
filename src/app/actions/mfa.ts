"use server";
import { redirect } from "next/navigation";
import { requireUser, markCurrentSessionMfaVerified } from "@/server/auth/session";
import { run, str } from "./util";
import * as M from "@/server/services/mfa";
import { clearRecoveryCodes, stashRecoveryCodes } from "@/server/auth/recovery-handoff";
import type { Actor } from "@/server/services/admin";

export async function ackRecoveryCodesAction() { await requireUser("admin", { skipMfa: true }); await clearRecoveryCodes(); redirect("/admin"); }

export async function confirmEnrollmentAction(f: FormData) {
  const u = await requireUser("admin", { skipMfa: true });
  await run(async () => { await stashRecoveryCodes(await M.confirmEnrollment(u.id, str(f, "code") ?? "")); await markCurrentSessionMfaVerified(); return "/mfa/recovery-codes"; }, "/mfa");
}
export async function challengeAction(f: FormData) {
  const u = await requireUser("admin", { skipMfa: true });
  await run(async () => { await M.checkSecondFactor(u.id, str(f, "code") ?? ""); await markCurrentSessionMfaVerified(); return "/admin"; }, "/mfa");
}
export async function regenerateCodesAction(f: FormData) {
  const u = await requireUser("admin");
  await run(async () => { await stashRecoveryCodes(await M.regenerateRecoveryCodes(u.id, str(f, "code") ?? "")); return "/mfa/recovery-codes"; }, "/mfa");
}
export async function resetMfaAction(f: FormData) {
  const u = await requireUser("admin"); const a: Actor = { id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] };
  await run(() => M.resetMfa(a, str(f, "userId") ?? ""), "/admin/users", "Two-factor authentication reset. They must enrol again at next sign-in.");
}

