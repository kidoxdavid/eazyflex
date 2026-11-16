"use server";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { requireUser } from "@/server/auth/session";
import { run, str, readUploads } from "./util";
import * as R from "@/server/services/relationships";
import * as M from "@/server/services/messaging";
import * as A from "@/server/services/assignments";

const home = (k: string) => (k === "worker" ? "/worker" : "/business");
const safe = (p: string | undefined, fb: string) => (p && /^\/(worker|business)\/[\w\-/?=&.%]*$/.test(p) ? p : fb);

export async function shortlistAction(f: FormData) {
  const u = await requireUser("business"); const id = str(f, "workerId") ?? "";
  await run(() => str(f, "remove") ? R.removeShortlisted(u.id, id) : R.shortlistWorker(u.id, id, str(f, "note")), safe(str(f, "back"), "/business/talent"), str(f, "remove") ? "Removed from shortlist" : "Added to shortlist");
}
export async function inviteAction(f: FormData) {
  const u = await requireUser("business");
  await run(() => R.inviteWorker(u.id, str(f, "opportunityId") ?? "", str(f, "workerId") ?? "", str(f, "message")), safe(str(f, "back"), "/business/talent"), "Invitation sent");
}
export async function declineInvitationAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => R.respondToInvitation(u.id, str(f, "id") ?? "", "declined"), "/worker/invitations", "Invitation declined");
}

export async function openConversationAction(f: FormData) {
  const u = await requireUser(); const back = safe(str(f, "back"), home(u.kind));
  let dest = back, err = "";
  try { const id = await M.startConversation(u.id, str(f, "counterpartId") ?? "", str(f, "opportunityId") || undefined); dest = `/${u.kind}/messages/${id}`; }
  catch (e: any) { err = e?.message ?? "Could not open conversation"; }
  redirect(err ? `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err)}` : dest);
}
export async function sendMessageAction(f: FormData) {
  const u = await requireUser(); const id = str(f, "conversationId") ?? "";
  const uploads = await readUploads(f);
  await run(() => M.sendMessage(u.id, id, str(f, "body") ?? "", uploads), `/${u.kind}/messages/${id}`);
}
export async function reportMessageAction(f: FormData) {
  const u = await requireUser(); const cid = str(f, "conversationId") ?? "";
  await run(() => M.reportMessage(u.id, str(f, "messageId") ?? "", str(f, "reason") ?? ""), `/${u.kind}/messages/${cid}`, "Reported. Our team will review it.");
}

export async function workerAssignmentAction(f: FormData) {
  const u = await requireUser("worker"); const id = str(f, "id") ?? "";
  const act = str(f, "action") as "start" | "submit" | "cancel";
  const uploads = await readUploads(f);
  await run(() => A.workerAction(u.id, id, act, { note: str(f, "note"), hoursWorked: str(f, "hoursWorked") ?? "", link: str(f, "link") ?? "", reason: str(f, "reason") }, uploads), `/worker/assignments/${id}`, act === "start" ? "Work started" : act === "submit" ? "Work submitted for review" : "Assignment cancelled");
}
export async function businessAssignmentAction(f: FormData) {
  const u = await requireUser("business"); const id = str(f, "id") ?? "";
  const act = str(f, "action") as "approve" | "request_changes" | "cancel";
  await run(() => A.businessAction(u.id, id, act, str(f, "note") ?? ""), `/business/assignments/${id}`, act === "approve" ? "Work approved" : act === "cancel" ? "Assignment cancelled" : "Changes requested");
}
export async function reviewAction(f: FormData) {
  const u = await requireUser(); const id = str(f, "assignmentId") ?? "";
  await run(() => A.submitReview(u.id, id, { rating: str(f, "rating"), quality: str(f, "quality") ?? "", communication: str(f, "communication") ?? "", reliability: str(f, "reliability") ?? "", professionalism: str(f, "professionalism") ?? "", comment: str(f, "comment") }), `/${u.kind}/assignments/${id}`, "Review submitted");
}
export async function markNotificationsReadAction() {
  const u = await requireUser();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
  redirect(`/${u.kind}/notifications`);
}

export async function savePrefsAction(f: FormData) {
  const u = await requireUser();
  const { savePrefs } = await import("@/server/notify");
  await run(() => savePrefs(u.id, { applications: f.get("applications") === "on", messages: f.get("messages") === "on", assignments: f.get("assignments") === "on", invitations: f.get("invitations") === "on", reviews: f.get("reviews") === "on", alerts: f.get("alerts") === "on" }), `/${u.kind}/settings`, "Notification preferences saved");
}

export async function reportReviewAction(f: FormData) {
  const u = await requireUser(); const { reportReview } = await import("@/server/services/moderation");
  await run(() => reportReview(u.id, str(f, "reviewId") ?? "", str(f, "reason") ?? ""), `/${u.kind}/assignments/${str(f, "assignmentId")}`, "Reported. Our team will review it.");
}

export async function deleteAccountAction(f: FormData) {
  const u = await requireUser(); const { deleteAccount } = await import("@/server/services/account"); const { destroySession } = await import("@/server/auth/session");
  let err = "";
  try { await deleteAccount(u.id, str(f, "password") ?? "", str(f, "confirm") ?? ""); } catch (e: any) { err = e?.message ?? "Could not delete the account"; }
  if (err) redirect(`/${u.kind}/account?error=${encodeURIComponent(err)}`);
  await destroySession(); redirect("/?ok=" + encodeURIComponent("Your account was deleted."));
}
