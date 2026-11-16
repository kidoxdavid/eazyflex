"use server";
import { requireUser } from "@/server/auth/session";
import { run, str, strs } from "./util";
import * as A from "@/server/services/admin";

const actor = async () => { const u = await requireUser("admin"); return { id: u.id, kind: u.kind, adminRole: u.adminRole as A.Actor["adminRole"] }; };

export async function userStatusAction(f: FormData) {
  const a = await actor();
  await run(() => A.setUserStatus(a, str(f, "userId") ?? "", str(f, "status") as "suspended", str(f, "reason") ?? ""), "/admin/users", "Account status updated");
}
export async function moderateAction(f: FormData) {
  const a = await actor();
  await run(() => A.moderateOpportunity(a, str(f, "id") ?? "", str(f, "decision") as "approve", str(f, "note")), "/admin/opportunities", "Moderation recorded");
}
export async function verificationDecisionAction(f: FormData) {
  const a = await actor();
  await run(() => A.decideVerification(a, str(f, "id") ?? "", str(f, "decision") as "verified", str(f, "notes")), "/admin/verification", "Decision recorded");
}
export async function publishRulesAction(f: FormData) {
  const a = await actor();
  const n = (k: string) => Number(str(f, k) ?? 0);
  await run(async () => { await A.publishMatchingRules(a, {
    weights: { skills: n("w_skills"), availability: n("w_availability"), location: n("w_location"), arrangement: n("w_arrangement"), compensation: n("w_compensation"), experience: n("w_experience"), duration: n("w_duration"), preferences: n("w_preferences") },
    thresholds: { recommend: n("t_recommend"), strong: n("t_strong") }, mandatory: strs(f, "mandatory"), note: str(f, "note"),
  }); }, "/admin/matching", "New matching rules version published");
}
export async function categoryAction(f: FormData) {
  const a = await actor();
  await run(() => A.upsertCategory(a, { id: str(f, "id") || undefined, name: str(f, "name") ?? "", description: str(f, "description"), requiresApproval: str(f, "requiresApproval") === "on", active: str(f, "active") !== "off" }), "/admin/catalog", "Category saved");
}
export async function skillAction(f: FormData) {
  const a = await actor();
  await run(() => A.upsertSkill(a, { name: str(f, "name") ?? "", categoryId: str(f, "categoryId") }), "/admin/catalog", "Skill added");
}
