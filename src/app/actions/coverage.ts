"use server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { run, str, bool, toMinutes } from "./util";
import * as C from "@/server/services/coverage";

const sliceList = z.array(z.object({ workerId: z.string().uuid(), weekday: z.number().int(), startMinute: z.number().int(), endMinute: z.number().int() }));

export async function proposeCoverageAction(f: FormData) {
  const u = await requireUser("business"); const id = str(f, "opportunityId") ?? "";
  await run(async () => {
    const slices = sliceList.parse(JSON.parse(str(f, "slices") ?? "[]"));
    const n = await C.proposeSlices(u.id, id, slices);
    return `/business/opportunities/${id}/coverage?ok=${encodeURIComponent(`${n} slice${n === 1 ? "" : "s"} proposed. Nobody is booked until each worker confirms.`)}`;
  }, `/business/opportunities/${id}/coverage`);
}
export async function manualSliceAction(f: FormData) {
  const u = await requireUser("business"); const id = str(f, "opportunityId") ?? "";
  await run(async () => {
    const s = toMinutes(str(f, "start")), e = toMinutes(str(f, "end"));
    if (s === null || e === null) throw new (await import("@/server/services/identity")).ServiceError("Enter a start and end time");
    await C.proposeSlices(u.id, id, [{ workerId: str(f, "workerId") ?? "", weekday: Number(str(f, "weekday")), startMinute: s, endMinute: e === 0 ? 1440 : e }]);
  }, `/business/opportunities/${id}/coverage`, "Slice proposed. Nobody is booked until the worker confirms.");
}
export async function respondSliceAction(f: FormData) {
  const u = await requireUser("worker");
  const d = str(f, "decision") as "confirm" | "decline";
  await run(() => C.respondToSlice(u.id, str(f, "sliceId") ?? "", d, bool(f, "acknowledge")), "/worker/coverage", d === "confirm" ? "Confirmed — this is now in your schedule." : "Declined.");
}
export async function releaseSliceAction(f: FormData) {
  const u = await requireUser(); const back = str(f, "back") ?? `/${u.kind}/coverage`;
  await run(() => C.releaseSlice(u.id, str(f, "sliceId") ?? "", str(f, "reason") ?? ""), /^\/(worker|business)\/[\w\-/]*$/.test(back) ? back : `/${u.kind}`, "Slice released");
}
export async function addHandoverAction(f: FormData) {
  const u = await requireUser(); const back = str(f, "back") ?? `/${u.kind}`;
  await run(() => C.addHandover(u.id, str(f, "fromSliceId") ?? "", str(f, "toSliceId") ?? "", str(f, "note") ?? ""), /^\/(worker|business)\/[\w\-/]*$/.test(back) ? back : `/${u.kind}`, "Handover note saved");
}
export async function ackHandoverAction(f: FormData) {
  const u = await requireUser("worker");
  await run(() => C.acknowledgeHandover(u.id, str(f, "noteId") ?? ""), "/worker/coverage", "Handover acknowledged");
}
