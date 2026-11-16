import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SMTPServer } from "smtp-server";
import { db } from "@/server/db/client";
import { applicationAnswers, auditLogs, emailOutbox, files, messageReports, reviews, skills, users } from "@/server/db/schema";
import { applyToOpportunity, applicationAnswersFor, businessSetApplicationStatus, workerSetApplicationStatus } from "@/server/services/applications";
import { getOpportunityDetail, saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding } from "@/server/services/worker";
import { getConversation, reportMessage, sendMessage, startConversation } from "@/server/services/messaging";
import { businessAction, getAssignment, submitReview, visibleReviews, workerAction, workerRatingSummary } from "@/server/services/assignments";
import { openReports, reportReview, resolveMessageReport, resolveReviewReport } from "@/server/services/moderation";
import { authoriseDownload, readFile, validateUpload } from "@/server/services/files";
import { getPrefs, notify, savePrefs } from "@/server/notify";
import { processOutbox } from "@/server/email";
import type { Actor } from "@/server/services/admin";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(async () => { await freshDb(); process.env.STORAGE_DIR = "./.storage-test"; });
afterAll(closeDb);

const post = (cat: string, o: Record<string, unknown> = {}) => ({ title: "Weekly bookkeeping support", description: "Keep our books current by entering invoices and reconciling the bank feed each week.", engagementType: "micro_task", categoryId: cat, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, ...o });
async function worker() {
  const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Bookkeeper", summary: "I keep small-business books tidy and accurate for busy owners.", experienceLevel: "intermediate", skillIds: [sk[0].id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true }); await saveAvailability(w.id, { windows: [{ weekday: 2, startMinute: 540, endMinute: 900 }] }); await completeOnboarding(w.id); return w;
}
const proposal = "I have five years of bookkeeping experience and can start right away.";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
async function assignment(opp: Record<string, unknown> = {}) {
  const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
  const o = await saveOpportunity(b.id, biz.id, post(cat.id, opp), { publish: true });
  const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal, proposedRate: 35 });
  await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
  const asg = (await import("@/server/db/schema")).assignments; const [row] = await db.select().from(asg).where(eq(asg.applicationId, a.id));
  return { b, w, biz, o, a, asg: row };
}
const admin = async (role: NonNullable<Actor["adminRole"]>) => { const [u] = await db.insert(users).values({ email: `${role}.${Math.random()}@admin.test`, passwordHash: "x", kind: "admin", adminRole: role, fullName: role, emailVerifiedAt: new Date() }).returning(); return { id: u.id, kind: "admin", adminRole: role } as Actor; };

describe("screening questions", () => {
  it("are stored with the opportunity, enforced on apply, and answers reach the business", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
    const o = await saveOpportunity(b.id, biz.id, post(cat.id, { questions: [{ prompt: "Which accounting software have you used?", required: true }, { prompt: "Anything else to add?", required: false }] }), { publish: true });
    const d = await getOpportunityDetail(o.id); expect(d!.questions).toHaveLength(2);
    const [q1, q2] = d!.questions;
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal, answers: {} })).rejects.toThrow(/Please answer/);
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal, answers: { [q1.id]: "   " } })).rejects.toThrow(/Please answer/);
    await expect(applyToOpportunity(w.id, { opportunityId: o.id, proposal, answers: { [q1.id]: "QuickBooks", [crypto.randomUUID()]: "x" } })).rejects.toThrow(/does not belong/);
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal, answers: { [q1.id]: "QuickBooks and Xero" } });
    const ans = await applicationAnswersFor([a.id]); expect(ans.map((x) => x.answer)).toEqual(["QuickBooks and Xero"]);
    expect(q2.required).toBe(false);
  });
  it("validates question length/count, and freezes questions once someone has applied", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
    await expect(saveOpportunity(b.id, biz.id, post(cat.id, { questions: [{ prompt: "hey", required: true }] }), { publish: true })).rejects.toThrow();
    await expect(saveOpportunity(b.id, biz.id, post(cat.id, { questions: Array.from({ length: 6 }, () => ({ prompt: "A fair question?", required: true })) }), { publish: true })).rejects.toThrow();
    const o = await saveOpportunity(b.id, biz.id, post(cat.id, { questions: [{ prompt: "Original question?", required: false }] }), { publish: true });
    await applyToOpportunity(w.id, { opportunityId: o.id, proposal });
    await saveOpportunity(b.id, biz.id, post(cat.id, { questions: [{ prompt: "Replacement question?", required: true }] }), { publish: true, id: o.id });
    expect((await getOpportunityDetail(o.id))!.questions[0].prompt).toBe("Original question?");
    expect(await db.select().from(applicationAnswers)).toBeDefined();
  });
});

describe("notification email and preferences", () => {
  it("queues an email for a verified user, respects opt-out, and never includes message text", async () => {
    const s = await assignment(); const id = await startConversation(s.b.id, s.w.id);
    await db.delete(emailOutbox).where(eq(emailOutbox.userId, s.w.id));
    await sendMessage(s.b.id, id, "SECRET-BODY please call me later");
    const mails = await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, s.w.id), eq(emailOutbox.category, "messages")));
    expect(mails).toHaveLength(1); expect(mails[0].body).not.toMatch(/SECRET-BODY/); expect(mails[0].body).toMatch(/Manage email preferences/);
    await sendMessage(s.b.id, id, "second message"); // throttled: still one email in 15 minutes
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, s.w.id), eq(emailOutbox.category, "messages")))).toHaveLength(1);
  });
  it("opt-outs are honoured per category; unverified accounts get no notification email", async () => {
    const s = await assignment();
    await savePrefs(s.w.id, { applications: true, messages: true, assignments: false, invitations: true, reviews: true });
    expect((await getPrefs(s.w.id)).emailAssignments).toBe(false);
    await db.delete(emailOutbox).where(eq(emailOutbox.userId, s.w.id));
    await businessAction(s.b.id, s.asg.id, "cancel", "Project was postponed");
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, s.w.id), eq(emailOutbox.category, "assignments")))).toHaveLength(0);
  });
  it("unverified accounts get the in-app notification but no notification email", async () => {
    const u = await makeUser("worker", { verify: false });
    await notify(u.id, "message", "New message", "You have a new message.", "/worker/messages");
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.userId, u.id), eq(emailOutbox.category, "messages")))).toHaveLength(0);
    const { notifications } = await import("@/server/db/schema");
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(1);
  });
  it("outbox driver delivers nothing and marks nothing sent", async () => {
    process.env.EMAIL_DRIVER = "outbox";
    expect(await processOutbox()).toEqual({ sent: 0, failed: 0, skipped: true });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.status, "sent"))).toHaveLength(0);
  });
  it("smtp driver delivers through a real SMTP server and records sent / failed honestly", async () => {
    const received: string[] = [];
    const server = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, _s, cb) { let d = ""; stream.on("data", (c) => (d += c)); stream.on("end", () => { received.push(d); cb(); }); } });
    await new Promise<void>((r) => server.listen(2526, "127.0.0.1", r));
    await db.delete(emailOutbox);
    await db.insert(emailOutbox).values({ toEmail: "to@example.test", template: "t", subject: "Hello subject", body: "Body text", link: "http://x/y", status: "queued" });
    process.env.EMAIL_DRIVER = "smtp"; process.env.SMTP_URL = "smtp://127.0.0.1:2526"; process.env.EMAIL_FROM = "Openhour <no-reply@example.test>";
    expect(await processOutbox()).toEqual({ sent: 1, failed: 0, skipped: false });
    expect(received[0]).toMatch(/Subject: Hello subject/); expect(received[0]).toMatch(/Body text/);
    expect((await db.select().from(emailOutbox))[0].status).toBe("sent");
    await new Promise<void>((r) => server.close(() => r()));
    await db.insert(emailOutbox).values({ toEmail: "x@example.test", template: "t", subject: "Will fail", body: "b", status: "queued" });
    const r = await processOutbox(); expect(r.failed).toBe(1); // server is down: not reported as sent
    const row = (await db.select().from(emailOutbox).where(eq(emailOutbox.subject, "Will fail")))[0]; expect(row.status).toBe("queued"); expect(row.attempts).toBe(1); expect(row.error).toBeTruthy();
    process.env.EMAIL_DRIVER = "outbox";
  });
});

describe("file validation", () => {
  it("allows only listed types whose content matches, within size limits", () => {
    expect(validateUpload({ name: "invoice.pdf", data: PDF }).mime).toBe("application/pdf");
    expect(() => validateUpload({ name: "run.exe", data: Buffer.from("MZ") })).toThrow(/isn’t allowed/);
    expect(() => validateUpload({ name: "fake.pdf", data: Buffer.from("<script>alert(1)</script>") })).toThrow(/doesn’t look like a real/);
    expect(() => validateUpload({ name: "x.png", data: PDF })).toThrow(/real \.png/);
    expect(() => validateUpload({ name: "notes.txt", data: Buffer.from([65, 0, 66]) })).toThrow(/real \.txt/);
    expect(() => validateUpload({ name: "empty.pdf", data: Buffer.alloc(0) })).toThrow(/empty/);
    expect(() => validateUpload({ name: "big.pdf", data: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) })).toThrow(/10 MB/);
    expect(() => validateUpload({ name: "page.html", data: Buffer.from("<html>") })).toThrow(/isn’t allowed/);
  });
});

describe("attachments: storage and access control", () => {
  it("stores a message attachment privately and only participants can download it", async () => {
    const s = await assignment(); const intruder = await worker(); const otherBiz = await makeUser("business");
    const id = await startConversation(s.b.id, s.w.id);
    await sendMessage(s.b.id, id, "", [{ name: "brief.pdf", data: PDF }]);
    const conv = await getConversation(s.w.id, id); const att = conv.msgs[0].attachments[0];
    expect(conv.msgs[0].body).toBe("📎 Attachment"); expect(att.name).toBe("brief.pdf");
    const asUser = (u: { id: string; kind: string }) => ({ id: u.id, kind: u.kind, adminRole: null });
    const f = await authoriseDownload(asUser(s.w), att.id); expect((await readFile(f.storageKey)).equals(PDF)).toBe(true);
    await authoriseDownload(asUser(s.b), att.id);
    for (const u of [intruder, otherBiz]) await expect(authoriseDownload(asUser(u), att.id)).rejects.toThrow(/not found/i);
    const [row] = await db.select().from(files).where(eq(files.id, att.id)); expect(row.storageKey).not.toMatch(/brief/); expect(row.scanStatus).toBe("unscanned");
  });
  it("rejects bad uploads without leaving a message behind", async () => {
    const s = await assignment(); const id = await startConversation(s.b.id, s.w.id);
    const before = (await getConversation(s.w.id, id)).msgs.length;
    await expect(sendMessage(s.b.id, id, "here you go", [{ name: "evil.exe", data: Buffer.from("MZ") }])).rejects.toThrow(/isn’t allowed/);
    await expect(sendMessage(s.b.id, id, "too many", Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.pdf`, data: PDF })))).rejects.toThrow(/at most 3/);
    expect((await getConversation(s.w.id, id)).msgs.length).toBe(before);
  });
  it("blocks contact details smuggled in a file name before an assignment exists", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
    const o = await saveOpportunity(b.id, biz.id, post(cat.id), { publish: true }); await applyToOpportunity(w.id, { opportunityId: o.id, proposal });
    const id = await startConversation(b.id, w.id);
    await expect(sendMessage(w.id, id, "my resume", [{ name: "call-403-555-0100-now.pdf", data: PDF }])).rejects.toThrow(/after an assignment/);
  });
  it("work submissions can carry files visible to both parties only", async () => {
    const s = await assignment(); const stranger = await worker();
    await workerAction(s.w.id, s.asg.id, "submit", { note: "Deliverable attached for review", hoursWorked: 2 }, [{ name: "report.pdf", data: PDF }]);
    const d = await getAssignment(s.b.id, s.asg.id); const att = d.submissions[0].attachments[0]; expect(att.name).toBe("report.pdf");
    await authoriseDownload({ id: s.b.id, kind: "business", adminRole: null }, att.id);
    await expect(authoriseDownload({ id: stranger.id, kind: "worker", adminRole: null }, att.id)).rejects.toThrow(/not found/i);
    await expect(workerAction(s.w.id, s.asg.id, "submit", { note: "second try with a bad file", hoursWorked: 1 }, [{ name: "x.exe", data: Buffer.from("MZ") }])).rejects.toThrow();
    expect((await getAssignment(s.w.id, s.asg.id)).submissions).toHaveLength(1);
  });
});

describe("reports and moderation", () => {
  async function reported() {
    const s = await assignment(); const id = await startConversation(s.b.id, s.w.id);
    await sendMessage(s.b.id, id, "Earlier friendly message"); await sendMessage(s.b.id, id, "You are useless, do it again", [{ name: "note.pdf", data: PDF }]);
    const msgs = (await getConversation(s.w.id, id)).msgs; const bad = msgs[msgs.length - 1];
    await reportMessage(s.w.id, bad.id, "Abusive language"); return { ...s, id, bad };
  }
  it("only authorised roles can open the queue; viewing private content is audited", async () => {
    await reported();
    await expect(openReports(await admin("finance_admin"))).rejects.toThrow(/Forbidden/);
    await expect(openReports(await admin("read_only_analyst"))).rejects.toThrow(/Forbidden/);
    const mod = await admin("support_agent"); const q = await openReports(mod);
    expect(q.messages.length).toBeGreaterThan(0); expect(q.messages[0].context.length).toBeLessThanOrEqual(4);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.actorId, mod.id), eq(auditLogs.action, "report.message_content_accessed")));
    expect(logs).toHaveLength(1); expect(JSON.stringify(logs[0].detail)).toMatch(/messageIds/);
  });
  it("admins can download an attachment only while its message has an open report", async () => {
    const r = await reported(); const mod = await admin("content_moderator");
    const att = (await getConversation(r.w.id, r.id)).msgs.at(-1)!.attachments[0];
    await authoriseDownload({ id: mod.id, kind: "admin", adminRole: mod.adminRole }, att.id);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.actorId, mod.id), eq(auditLogs.action, "file.accessed_by_admin")))).length).toBe(1);
    await expect(authoriseDownload({ id: (await admin("finance_admin")).id, kind: "admin", adminRole: "finance_admin" }, att.id)).rejects.toThrow(/not found/i);
    const [rep] = await db.select().from(messageReports).where(eq(messageReports.messageId, r.bad.id));
    await resolveMessageReport(mod, rep.id, "actioned", "Warned the sender");
    await expect(authoriseDownload({ id: mod.id, kind: "admin", adminRole: mod.adminRole }, att.id)).rejects.toThrow(/not found/i); // closed: no standing access
    await expect(resolveMessageReport(mod, rep.id, "dismissed", "again please")).rejects.toThrow(/already resolved/);
  });
  it("resolution needs a note and is audited", async () => {
    const r = await reported(); const mod = await admin("platform_admin"); const [rep] = await db.select().from(messageReports).where(eq(messageReports.messageId, r.bad.id));
    await expect(resolveMessageReport(mod, rep.id, "dismissed", "  ")).rejects.toThrow(/resolution note/);
    await resolveMessageReport(mod, rep.id, "dismissed", "Tone is rude but not abusive");
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, rep.id))).some((l) => l.action === "report.message_dismissed")).toBe(true);
  });
  it("review reports: only the reviewed party can report; hiding removes it from display and ratings", async () => {
    const s = await assignment(); await workerAction(s.w.id, s.asg.id, "submit", { note: "All done and delivered", hoursWorked: 2 }); await businessAction(s.b.id, s.asg.id, "approve");
    await submitReview(s.b.id, s.asg.id, { rating: 1, comment: "Unfair and untrue" }); await submitReview(s.w.id, s.asg.id, { rating: 5 });
    const [rv] = await db.select().from(reviews).where(and(eq(reviews.assignmentId, s.asg.id), eq(reviews.revieweeId, s.w.id)));
    await expect(reportReview(s.b.id, rv.id, "I dislike my own review")).rejects.toThrow(/not found/i);
    await expect(reportReview(s.w.id, rv.id, "short")).rejects.toThrow(/at least 10/);
    await reportReview(s.w.id, rv.id, "This review is factually wrong and abusive");
    expect((await workerRatingSummary([s.w.id])).get(s.w.id)?.avg).toBe(1);
    const mod = await admin("content_moderator"); const q = await openReports(mod); const item = q.reviews.find((x) => x.reviewId === rv.id)!;
    await expect(resolveReviewReport(await admin("finance_admin"), item.reportId, "hide", "x".repeat(10))).rejects.toThrow(/Forbidden/);
    await resolveReviewReport(mod, item.reportId, "hide", "Violates review policy");
    expect((await visibleReviews(s.asg.id, s.w.id)).map((x) => x.id)).not.toContain(rv.id);
    expect((await workerRatingSummary([s.w.id])).get(s.w.id)).toBeUndefined();
  });
});
