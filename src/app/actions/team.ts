"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { run, str } from "./util";
import * as T from "@/server/services/team";

export async function inviteMemberAction(f: FormData) {
  const u = await requireUser("business");
  await run(() => T.inviteMember(u.id, str(f, "email") ?? "", str(f, "role") ?? ""), "/business/team", "Invitation sent. The link is valid for 7 days.");
}
export async function revokeInviteAction(f: FormData) { const u = await requireUser("business"); await run(() => T.revokeInvite(u.id, str(f, "id") ?? ""), "/business/team", "Invitation withdrawn"); }
export async function resendInviteAction(f: FormData) { const u = await requireUser("business"); await run(() => T.resendInvite(u.id, str(f, "id") ?? ""), "/business/team", "Invitation re-sent with a new link"); }
export async function changeRoleAction(f: FormData) { const u = await requireUser("business"); await run(() => T.changeRole(u.id, str(f, "userId") ?? "", str(f, "role") ?? ""), "/business/team", "Role updated"); }
export async function removeMemberAction(f: FormData) {
  const u = await requireUser("business"); const target = str(f, "userId") ?? "";
  if (target === u.id) { let err = ""; try { await T.removeMember(u.id, target); } catch (e: any) { err = e?.message ?? "Could not leave"; } redirect(err ? `/business/team?error=${encodeURIComponent(err)}` : "/business"); }
  await run(() => T.removeMember(u.id, target), "/business/team", "Team member removed");
}
export async function acceptInviteAction(f: FormData) {
  const u = await requireUser("business"); const token = str(f, "token") ?? "";
  await run(async () => { await T.acceptInvite(u.id, token); return "/business?ok=" + encodeURIComponent("You joined the team."); }, `/join-team?token=${encodeURIComponent(token)}`);
}
