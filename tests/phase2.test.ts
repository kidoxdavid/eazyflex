import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { assignments, reviews, skills, workerInvitations } from "@/server/db/schema";
import { saveOpportunity } from "@/server/services/opportunities";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus } from "@/server/services/applications";
import { getBusinessForUser } from "@/server/services/business";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding } from "@/server/services/worker";
import { inviteWorker, listShortlist, listWorkerInvitations, respondToInvitation, shortlistWorker } from "@/server/services/relationships";
import { getConversation, listConversations, reportMessage, sendMessage, startConversation } from "@/server/services/messaging";
import { businessAction, getAssignment, listAssignments, submitReview, visibleReviews, workerAction, workerRatingSummary } from "@/server/services/assignments";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(freshDb);
afterAll(closeDb);

const post = (cat: string, o: Record<string, unknown> = {}) => ({ title: "Weekly bookkeeping support", description: "Keep our books current by entering invoices and reconciling the bank feed each week.", engagementType: "micro_task", categoryId: cat, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, ...o });
async function discoverableWorker() {
  const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Bookkeeper", summary: "I keep small-business books tidy and accurate for busy owners.", experienceLevel: "intermediate", skillIds: [sk[0].id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true });
  await saveAvailability(w.id, { windows: [{ weekday: 2, startMinute: 540, endMinute: 900 }] });
  await completeOnboarding(w.id); return w;
}
async function biz() { const { cat } = await ref(); const b = await makeUser("business"); const m = (await getBusinessForUser(b.id))!.b; return { b, biz: m, cat }; }
const proposal = "I have five years of bookkeeping experience and can start right away.";
async function acceptedScenario(opp: Record<string, unknown> = {}) {
  const { b, biz: m, cat } = await biz(); const w = await discoverableWorker();
  const o = await saveOpportunity(b.id, m.id, post(cat.id, opp), { publish: true });
  const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal, proposedRate: 35 });
  await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
  const [asg] = await db.select().from(assignments).where(eq(assignments.applicationId, a.id));
  return { b, w, biz: m, o, a, asg };
}

describe("shortlist and invitations", () => {
  it("shortlists only discoverable workers and hides those who opt out", async () => {
    const { b } = await biz(); const w = await discoverableWorker(); const hidden = await makeUser("worker");
    await shortlistWorker(b.id, w.id, "good fit");
    expect((await listShortlist(b.id)).map((s) => s.workerId)).toEqual([w.id]);
    await expect(shortlistWorker(b.id, hidden.id)).rejects.toThrow(/not found/i);
    const other = await biz(); expect(await listShortlist(other.b.id)).toEqual([]); // not visible across businesses
  });
  it("invites to own published opportunity only, blocks duplicates and applicants; applying accepts the invite", async () => {
    const A = await biz(); const B = await biz(); const w = await discoverableWorker();
    const o = await saveOpportunity(A.b.id, A.biz.id, post(A.cat.id), { publish: true });
    await expect(inviteWorker(B.b.id, o.id, w.id)).rejects.toThrow(/not found/i);
    await inviteWorker(A.b.id, o.id, w.id, "We’d love your help");
    await expect(inviteWorker(A.b.id, o.id, w.id)).rejects.toThrow(/already invited/);
    expect((await listWorkerInvitations(w.id))).toHaveLength(1);
    await applyToOpportunity(w.id, { opportunityId: o.id, proposal });
    expect((await db.select().from(workerInvitations).where(eq(workerInvitations.opportunityId, o.id)))[0].status).toBe("accepted");
    const o2 = await saveOpportunity(A.b.id, A.biz.id, post(A.cat.id, { title: "Another bookkeeping job" }), { publish: true });
    await applyToOpportunity(w.id, { opportunityId: o2.id, proposal });
    await expect(inviteWorker(A.b.id, o2.id, w.id)).rejects.toThrow(/already applied/);
  });
  it("worker can decline; another worker cannot answer someone else's invitation", async () => {
    const A = await biz(); const w = await discoverableWorker(); const x = await discoverableWorker();
    const o = await saveOpportunity(A.b.id, A.biz.id, post(A.cat.id), { publish: true });
    await inviteWorker(A.b.id, o.id, w.id);
    const [inv] = await listWorkerInvitations(w.id);
    await expect(respondToInvitation(x.id, inv.i.id, "declined")).rejects.toThrow(/not found/i);
    await respondToInvitation(w.id, inv.i.id, "declined");
    await expect(respondToInvitation(w.id, inv.i.id, "declined")).rejects.toThrow(/already answered/);
  });
});

describe("messaging", () => {
  it("requires an existing relationship; strangers cannot start conversations either way", async () => {
    const A = await biz(); const w = await discoverableWorker();
    await expect(startConversation(A.b.id, w.id)).rejects.toThrow(/once there is an application/);
    await expect(startConversation(w.id, A.biz.id)).rejects.toThrow(/once there is an application/);
  });
  it("participants converse; outsiders get not-found; unread tracking works", async () => {
    const { b, w, biz: m } = await acceptedScenario(); const intruder = await discoverableWorker(); const otherBiz = await biz();
    const id = await startConversation(b.id, w.id);
    expect(await startConversation(w.id, m.id)).toBe(id); // same thread both ways
    await sendMessage(b.id, id, "Welcome aboard — can you start Tuesday?");
    expect((await listConversations(w.id))[0].unread).toBe(true);
    const conv = await getConversation(w.id, id);
    expect(conv.msgs).toHaveLength(1);
    expect((await listConversations(w.id))[0].unread).toBe(false);
    await expect(getConversation(intruder.id, id)).rejects.toThrow(/not found/i);
    await expect(sendMessage(otherBiz.b.id, id, "hi there")).rejects.toThrow(/not found/i);
    expect(conv.workerName).toBe("Test Worker"); // worker sees own name; business sees only "First L."
    expect((await getConversation(b.id, id)).workerName).toBe("Test W.");
  });
  it("blocks contact details before an assignment exists, allows them after", async () => {
    const A = await biz(); const w = await discoverableWorker();
    const o = await saveOpportunity(A.b.id, A.biz.id, post(A.cat.id), { publish: true });
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal });
    const id = await startConversation(A.b.id, w.id);
    await expect(sendMessage(w.id, id, "email me at me@example.com")).rejects.toThrow(/after an assignment/);
    await expect(sendMessage(w.id, id, "call 403 555 0100 please")).rejects.toThrow(/after an assignment/);
    await expect(sendMessage(w.id, id, "chat on https://wa.me/14035550100")).rejects.toThrow(/after an assignment/);
    await businessSetApplicationStatus(A.b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
    await sendMessage(w.id, id, "email me at me@example.com");
  });
  it("validates content, rate-limits and supports reporting by the recipient only", async () => {
    const { b, w } = await acceptedScenario(); const id = await startConversation(b.id, w.id);
    await expect(sendMessage(b.id, id, "   ")).rejects.toThrow(/Write a message/);
    await expect(sendMessage(b.id, id, "x".repeat(4001))).rejects.toThrow(/too long/);
    await sendMessage(b.id, id, "Please send the draft by Friday.");
    const msg = (await getConversation(w.id, id)).msgs[0];
    await expect(reportMessage(b.id, msg.id, "spam spam")).rejects.toThrow(/own message/);
    await reportMessage(w.id, msg.id, "This feels pushy");
    let last: any; for (let i = 0; i < 32; i++) last = await sendMessage(b.id, id, `msg ${i}`).catch((e) => e);
    expect(last.code).toBe("rate_limited");
  });
});

describe("assignments", () => {
  it("accepting an offer creates one assignment with the agreed rate snapshot", async () => {
    const { asg, o } = await acceptedScenario();
    expect(asg.status).toBe("confirmed"); expect(asg.agreedCents).toBe(3500); expect(asg.opportunityId).toBe(o.id);
  });
  it("runs the full lifecycle: start → submit (hours required) → changes → resubmit → approve", async () => {
    const { b, w, asg } = await acceptedScenario();
    await expect(businessAction(b.id, asg.id, "approve")).rejects.toThrow(/no submitted work/);
    await workerAction(w.id, asg.id, "start");
    await expect(workerAction(w.id, asg.id, "start")).rejects.toThrow(/already started/);
    await expect(workerAction(w.id, asg.id, "submit", { note: "All entered for the week" })).rejects.toThrow(/hours/);
    await workerAction(w.id, asg.id, "submit", { note: "All entered for the week", hoursWorked: 3.5 });
    await expect(businessAction(b.id, asg.id, "request_changes", "")).rejects.toThrow(/what needs to change/);
    await businessAction(b.id, asg.id, "request_changes", "Please reconcile the March invoices too.");
    await workerAction(w.id, asg.id, "submit", { note: "March invoices added and reconciled", hoursWorked: 1 });
    await businessAction(b.id, asg.id, "approve", "Thanks!");
    const d = await getAssignment(w.id, asg.id);
    expect(d.a.status).toBe("completed"); expect(d.submissions).toHaveLength(2); expect(d.history.map((h) => h.toStatus)).toEqual(["in_progress", "submitted", "changes_requested", "submitted", "completed"]);
    await expect(businessAction(b.id, asg.id, "approve")).rejects.toThrow();
    await expect(workerAction(w.id, asg.id, "cancel", { reason: "changed my mind" })).rejects.toThrow(/cancelled now/);
  });
  it("fixed-fee work does not require hours", async () => {
    const { w, asg } = await acceptedScenario({ engagementType: "fixed_project", payType: "fixed", payMin: 400, payMax: 500, deliverables: "A cleaned spreadsheet and summary" });
    await workerAction(w.id, asg.id, "submit", { note: "Spreadsheet delivered via link" });
  });
  it("only the two parties can see or act on an assignment", async () => {
    const { w, asg, b } = await acceptedScenario(); const other = await biz(); const stranger = await discoverableWorker();
    for (const u of [other.b.id, stranger.id]) await expect(getAssignment(u, asg.id)).rejects.toThrow(/not found/i);
    await expect(workerAction(stranger.id, asg.id, "start")).rejects.toThrow(/not found/i);
    await expect(businessAction(other.b.id, asg.id, "cancel", "no longer needed")).rejects.toThrow(/not found/i);
    await expect(businessAction(w.id, asg.id, "cancel", "worker pretending")).rejects.toThrow(/not found/i); // role cannot be spoofed
    await expect(workerAction(b.id, asg.id, "start")).rejects.toThrow(/not found/i);
    expect((await listAssignments(w.id, "worker")).length).toBe(1); expect((await listAssignments(stranger.id, "worker"))).toEqual([]);
  });
  it("cancellation needs a reason and is recorded", async () => {
    const { b, w, asg } = await acceptedScenario();
    await expect(businessAction(b.id, asg.id, "cancel", "no")).rejects.toThrow(/reason/);
    await businessAction(b.id, asg.id, "cancel", "Project was postponed");
    const d = await getAssignment(w.id, asg.id); expect(d.a.status).toBe("cancelled"); expect(d.a.cancelReason).toBe("Project was postponed");
  });
});

describe("reviews", () => {
  async function completed() {
    const s = await acceptedScenario(); await workerAction(s.w.id, s.asg.id, "submit", { note: "Done and dusted today", hoursWorked: 2 }); await businessAction(s.b.id, s.asg.id, "approve"); return s;
  }
  it("opens only after completion, once per party, with 1–5 ratings", async () => {
    const s = await acceptedScenario();
    await expect(submitReview(s.w.id, s.asg.id, { rating: 5 })).rejects.toThrow(/once the assignment is completed/);
    await workerAction(s.w.id, s.asg.id, "submit", { note: "Done and dusted today", hoursWorked: 2 }); await businessAction(s.b.id, s.asg.id, "approve");
    await expect(submitReview(s.b.id, s.asg.id, { rating: 6 })).rejects.toThrow(); await expect(submitReview(s.b.id, s.asg.id, { rating: 0 })).rejects.toThrow();
    await submitReview(s.b.id, s.asg.id, { rating: 4, quality: 5 });
    await expect(submitReview(s.b.id, s.asg.id, { rating: 5 })).rejects.toThrow(/already reviewed/);
  });
  it("is blind: the other party's review stays hidden until both have reviewed", async () => {
    const s = await completed();
    await submitReview(s.b.id, s.asg.id, { rating: 2, comment: "Late delivery" });
    expect(await visibleReviews(s.asg.id, s.w.id)).toHaveLength(0); // worker cannot see it yet, so cannot retaliate
    expect(await visibleReviews(s.asg.id, s.b.id)).toHaveLength(1); // reviewer sees their own
    expect((await workerRatingSummary([s.w.id])).get(s.w.id)).toBeUndefined(); // not counted publicly yet
    await submitReview(s.w.id, s.asg.id, { rating: 5 });
    expect(await visibleReviews(s.asg.id, s.w.id)).toHaveLength(2);
    expect((await workerRatingSummary([s.w.id])).get(s.w.id)).toEqual({ avg: 2, count: 1 });
  });
  it("reveals after the window even if the other party never reviews; outsiders cannot review", async () => {
    const s = await completed(); const stranger = await discoverableWorker();
    await expect(submitReview(stranger.id, s.asg.id, { rating: 5 })).rejects.toThrow(/not found/i);
    await submitReview(s.b.id, s.asg.id, { rating: 3 });
    await db.update(assignments).set({ completedAt: new Date(Date.now() - 15 * 86400_000) }).where(eq(assignments.id, s.asg.id));
    expect(await visibleReviews(s.asg.id, s.w.id)).toHaveLength(1);
    expect((await workerRatingSummary([s.w.id])).get(s.w.id)?.count).toBe(1);
  });
  it("database rejects self-reviews", async () => {
    const s = await completed();
    await expect(db.insert(reviews).values({ assignmentId: s.asg.id, reviewerId: s.w.id, revieweeId: s.w.id, rating: 5 })).rejects.toThrow();
  });
});
