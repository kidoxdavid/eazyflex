"use server";
import { requireUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { run, str, strs, parseWindows, friendlyError, withParams } from "./util";
import { getBusinessForUser, saveBusinessProfile, submitBusinessVerification } from "@/server/services/business";
import { saveOpportunity, setOpportunityStatus } from "@/server/services/opportunities";
import { businessSetApplicationStatus, saveBusinessNote } from "@/server/services/applications";
import { ServiceError } from "@/server/services/identity";

async function biz() {
  const u = await requireUser("business");
  const m = await getBusinessForUser(u.id);
  if (!m) throw new ServiceError("No business account", "forbidden");
  return { u, b: m.b };
}

export async function saveOpportunityAction(f: FormData) {
  const { u, b } = await biz();
  const publish = str(f, "intent") === "publish";
  const id = str(f, "id") || undefined;
  const type = str(f, "engagementType") ?? "";
  const payload = {
    title: str(f, "title"), description: str(f, "description"), responsibilities: str(f, "responsibilities"), engagementType: type,
    categoryId: str(f, "categoryId"), arrangement: str(f, "arrangement"), serviceAreaId: str(f, "serviceAreaId") ?? "", locationNote: str(f, "locationNote"),
    payType: str(f, "payType"), payMin: str(f, "payMin"), payMax: str(f, "payMax") || str(f, "payMin"), estimatedHours: str(f, "estimatedHours") ?? "", hoursPerWeek: str(f, "hoursPerWeek") ?? "",
    startDate: str(f, "startDate") ?? "", endDate: str(f, "endDate") ?? "", applicationDeadline: str(f, "applicationDeadline") ?? "",
    workersNeeded: str(f, "workersNeeded") || 1, experienceLevel: str(f, "experienceLevel") || "entry", recurrenceNote: str(f, "recurrenceNote"),
    deliverables: str(f, "deliverables"), equipment: str(f, "equipment"), selectionProcess: str(f, "selectionProcess"), cancellationTerms: str(f, "cancellationTerms"),
    qualificationsRequired: str(f, "qualificationsRequired"), skillIds: strs(f, "skillIds"), mandatorySkillIds: strs(f, "mandatorySkillIds"), schedule: parseWindows(f, "s"),
  };
  let dest: string; let params: Record<string, string> = {};
  try {
    const r = await saveOpportunity(u.id, b.id, payload, { id, publish });
    const msg = r.status === "published" ? "Published — your opportunity is live." : r.status === "pending_review" ? "Submitted for review. It will go live once approved." : "Draft saved.";
    dest = `/business/opportunities/${r.id}`; params = { ok: msg };
  } catch (e) {
    const error = friendlyError(e);
    // Validation failed on publish: keep the user's work as a draft so nothing is lost, then explain what to fix.
    let draftId = id;
    if (publish) { try { draftId = (await saveOpportunity(u.id, b.id, payload, { id, publish: false })).id; } catch { /* incomplete draft: fall through */ } }
    dest = draftId ? `/business/post?id=${draftId}` : `/business/post?type=${encodeURIComponent(type)}`;
    params = { error: publish && draftId ? `${error} (Your entries were saved as a draft.)` : error };
  }
  redirect(withParams(dest, params));
}
export async function opportunityStatusAction(f: FormData) {
  const { u, b } = await biz();
  const id = str(f, "id") ?? "";
  await run(() => setOpportunityStatus(u.id, b.id, id, str(f, "status") as "paused"), `/business/opportunities/${id}`, "Status updated");
}
export async function applicationStatusAction(f: FormData) {
  const { u } = await biz();
  const back = `/business/opportunities/${str(f, "opportunityId")}`;
  await run(() => businessSetApplicationStatus(u.id, str(f, "applicationId") ?? "", str(f, "to") as "shortlisted", str(f, "note")), back, "Application updated");
}
export async function applicationNoteAction(f: FormData) {
  const { u } = await biz();
  await run(() => saveBusinessNote(u.id, str(f, "applicationId") ?? "", str(f, "note") ?? ""), `/business/opportunities/${str(f, "opportunityId")}`, "Note saved");
}
export async function saveBusinessProfileAction(f: FormData) {
  const { u, b } = await biz();
  await run(() => saveBusinessProfile(u.id, b.id, Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$ACTION")))), "/business/profile", "Business profile saved");
}
export async function submitVerificationAction(f: FormData) {
  const { u, b } = await biz();
  await run(() => submitBusinessVerification(u.id, b.id, str(f, "evidence") ?? ""), "/business/profile", "Submitted for verification. A reviewer will check your details.");
}
