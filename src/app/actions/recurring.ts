"use server";
import { requireUser } from "@/server/auth/session";
import { run, str } from "./util";
import * as R from "@/server/services/recurring";

const back = (f: FormData, u: { kind: string }) => { const id = str(f, "assignmentId") ?? ""; return `/${u.kind}/assignments/${id}`; };
export async function logSessionAction(f: FormData) { const u = await requireUser("worker"); await run(() => R.logSession(u.id, str(f, "occId") ?? "", { hours: str(f, "hours") ?? "", note: str(f, "note") }), back(f, u), "Session recorded"); }
export async function cancelSessionAction(f: FormData) { const u = await requireUser(); await run(() => R.cancelSession(u.id, str(f, "occId") ?? "", str(f, "reason") ?? ""), back(f, u), "Session cancelled"); }
export async function confirmSessionAction(f: FormData) { const u = await requireUser("business"); await run(() => R.confirmSession(u.id, str(f, "occId") ?? ""), back(f, u), "Session confirmed"); }
export async function confirmAllAction(f: FormData) { const u = await requireUser("business"); await run(async () => { const n = await R.confirmAllSessions(u.id, str(f, "assignmentId") ?? ""); if (!n) throw new (await import("@/server/services/identity")).ServiceError("There are no recorded sessions waiting for confirmation"); }, back(f, u), "Recorded sessions confirmed"); }
export async function missedAction(f: FormData) { const u = await requireUser("business"); await run(() => R.markMissed(u.id, str(f, "occId") ?? "", str(f, "note") ?? ""), back(f, u), "Session marked missed"); }
export async function endTermAction(f: FormData) { const u = await requireUser("business"); await run(() => R.endTerm(u.id, str(f, "assignmentId") ?? ""), back(f, u), "Term ended — the assignment is complete and reviews are open"); }
export async function proposeRenewalAction(f: FormData) { const u = await requireUser("business"); await run(() => R.proposeRenewal(u.id, str(f, "assignmentId") ?? "", { newEndDate: str(f, "newEndDate"), newRate: str(f, "newRate") ?? "", note: str(f, "note") }), back(f, u), "Renewal offered. Nothing changes unless the worker accepts."); }
export async function withdrawRenewalAction(f: FormData) { const u = await requireUser("business"); await run(() => R.withdrawRenewal(u.id, str(f, "offerId") ?? ""), back(f, u), "Renewal offer withdrawn"); }
export async function respondRenewalAction(f: FormData) {
  const u = await requireUser("worker"); const d = str(f, "decision") as "accept" | "decline";
  await run(() => R.respondToRenewal(u.id, str(f, "offerId") ?? "", d), back(f, u), d === "accept" ? "Renewal accepted — the term has been extended." : "Renewal declined. The term ends as planned.");
}
