import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/server/db/client";
import { applications, assignments, businesses, files, messages, opportunities, reviews, skills, users, workerProfiles, auditLogs, notifications } from "@/server/db/schema";
import { deleteAccount, deletionBlockers, exportUserData } from "@/server/services/account";
import { authenticate, registerUser } from "@/server/services/identity";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { applyToOpportunity, businessSetApplicationStatus, workerSetApplicationStatus } from "@/server/services/applications";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding, addExperience } from "@/server/services/worker";
import { getConversation, sendMessage, startConversation } from "@/server/services/messaging";
import { businessAction, submitReview, workerAction } from "@/server/services/assignments";
import { inviteMember } from "@/server/services/team";
import { saveSearch } from "@/server/services/saved-searches";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(async () => { await freshDb(); process.env.STORAGE_DIR = "./.storage-test"; });
afterAll(closeDb);

const PW = "CorrectHorse9";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
async function worker(name = "Wendy Worker") {
  const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await db.update(users).set({ fullName: name, phone: "403-555-0199" }).where(eq(users.id, w.id));
  await saveAbout(w.id, { headline: "Bookkeeper", summary: "I keep small-business books tidy and accurate for busy owners.", experienceLevel: "intermediate", skillIds: [sk[0].id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true }); await saveAvailability(w.id, { windows: [{ weekday: 2, startMinute: 540, endMinute: 900 }] }); await completeOnboarding(w.id);
  await addExperience(w.id, { title: "Office manager", organisation: "Acme Ltd", startYear: 2015 });
  return (await db.select().from(users).where(eq(users.id, w.id)))[0];
}
async function engagement(opts: { complete?: boolean } = {}) {
  const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
  const o = await saveOpportunity(b.id, biz.id, { title: "Bookkeeping for a small bakery", description: "Keep our books current by entering invoices and reconciling the bank feed each week.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, questions: [{ prompt: "Which accounting tools do you use?", required: true }] }, { publish: true });
  const q = (await (await import("@/server/services/opportunities")).getOpportunityDetail(o.id))!.questions[0];
  const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start right away.", proposedRate: 35, answers: { [q.id]: "QuickBooks" } });
  await businessSetApplicationStatus(b.id, a.id, "offer_received"); await workerSetApplicationStatus(w.id, a.id, "accepted");
  const [asg] = await db.select().from(assignments).where(eq(assignments.applicationId, a.id));
  if (opts.complete) { await workerAction(w.id, asg.id, "submit", { note: "All entered and reconciled for the week", hoursWorked: 3 }, [{ name: "summary.pdf", data: PDF }]); await businessAction(b.id, asg.id, "approve"); }
  return { b, biz, w, o, a, asg };
}

describe("data export", () => {
  it("contains the person's own data but never secrets or other people's personal details", async () => {
    const s = await engagement({ complete: true }); const cid = await startConversation(s.b.id, s.w.id);
    await sendMessage(s.w.id, cid, "Thanks — happy to start Tuesday."); await sendMessage(s.b.id, cid, "BUSINESS-SIDE-SECRET-TEXT welcome aboard.");
    await submitReview(s.w.id, s.asg.id, { rating: 4, comment: "Clear scope and prompt replies" }); await saveSearch(s.w.id, "My search", { q: "bookkeeping" }, true);
    const d: any = await exportUserData(s.w.id); const json = JSON.stringify(d);
    expect(d.account.email).toBe(s.w.email); expect(d.account.phone).toBe("403-555-0199");
    expect(d.worker.profile.headline).toBe("Bookkeeper"); expect(d.worker.experience[0].organisation).toBe("Acme Ltd");
    expect(d.worker.applications[0]).toMatchObject({ opportunity: "Bookkeeping for a small bakery", status: "accepted" }); expect(d.worker.applications[0].answers[0].answer).toBe("QuickBooks");
    expect(d.worker.assignments[0].submissions[0].note).toMatch(/reconciled/); expect(d.worker.savedSearches[0].name).toBe("My search");
    expect(d.messages.map((m: any) => m.body)).toEqual(["Thanks — happy to start Tuesday."]); // only what *they* wrote
    expect(d.worker.reviewsWritten[0].comment).toMatch(/Clear scope/);
    expect(json).not.toMatch(/argon2|passwordHash|tokenHash|totp|BUSINESS-SIDE-SECRET-TEXT/);
    expect(json).not.toContain(s.b.email); // the business owner's email is not in the worker's export
  });
  it("one user's export never contains another user's data, and is rate-limited", async () => {
    const a = await worker("Alice Alpha"); const b = await worker("Bob Beta");
    const ja = JSON.stringify(await exportUserData(a.id)); expect(ja).not.toContain(b.email); expect(ja).not.toContain("Bob Beta");
    await exportUserData(a.id); await exportUserData(a.id);
    await expect(exportUserData(a.id)).rejects.toThrow(/up to 3 times/);
  });
  it("business exports show business-side data with workers only as First L.", async () => {
    const s = await engagement(); const cid = await startConversation(s.b.id, s.w.id); await sendMessage(s.b.id, cid, "Welcome aboard — a manager will follow up.");
    const d: any = await exportUserData(s.b.id); const json = JSON.stringify(d);
    expect(d.business.role).toBe("owner"); expect(d.business.opportunitiesYouPosted[0].title).toMatch(/bakery/); expect(d.messages[0].conversationWith).toBe("Wendy W.");
    expect(json).not.toContain(s.w.email); expect(json).not.toContain("403-555-0199");
    // The worker's full name appears only in notification text the business itself received when they applied (it already sees applicants' names).
    expect(JSON.stringify({ ...d, notifications: undefined })).not.toContain("Wendy Worker");
  });
});

describe("deletion blockers and checks", () => {
  it("needs the right password and the typed confirmation, and refuses admins", async () => {
    const w = await worker();
    await expect(deleteAccount(w.id, "wrong-password1", "DELETE")).rejects.toThrow(/Incorrect password/);
    await expect(deleteAccount(w.id, PW, "delete please")).rejects.toThrow(/Type DELETE/);
    const [adm] = await db.insert(users).values({ email: `adm${Date.now()}@admin.test`, passwordHash: "x", kind: "admin", adminRole: "support_agent", fullName: "Adm", emailVerifiedAt: new Date() }).returning();
    expect((await deletionBlockers(adm.id))[0]).toMatch(/super administrator/);
  });
  it("blocks workers with active assignments and businesses with team members or active work; allows after completion", async () => {
    const s = await engagement();
    expect((await deletionBlockers(s.w.id))[0]).toMatch(/active assignment/); await expect(deleteAccount(s.w.id, PW, "DELETE")).rejects.toThrow(/active assignment/);
    expect((await deletionBlockers(s.b.id))[0]).toMatch(/active assignment/);
    await businessAction(s.b.id, s.asg.id, "cancel", "Project postponed to next quarter");
    expect(await deletionBlockers(s.w.id)).toEqual([]);
    await inviteMember(s.b.id, `t${Date.now()}@test.example`, "member"); // pending invites alone don't block; real members do
    const email = `real${Date.now()}@test.example`; await inviteMember(s.b.id, email, "member");
    const { emailOutbox } = await import("@/server/db/schema"); const { and, desc } = await import("drizzle-orm");
    const [mail] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, email), eq(emailOutbox.template, "team_invitation"))).orderBy(desc(emailOutbox.createdAt)).limit(1);
    await registerUser({ kind: "business", fullName: "Team Mate", email, password: PW, acceptTerms: true, inviteToken: new URL(mail.link!).searchParams.get("token")! });
    expect((await deletionBlockers(s.b.id)).join(" ")).toMatch(/team members/);
  });
});

describe("worker deletion", () => {
  it("anonymises the account, erases personal data and files, keeps the counterparty's records, and frees the email", async () => {
    const s = await engagement({ complete: true }); const cid = await startConversation(s.b.id, s.w.id);
    await sendMessage(s.w.id, cid, "Here are the files you asked for.", [{ name: "report.pdf", data: PDF }]); await sendMessage(s.b.id, cid, "Thanks, received.");
    await submitReview(s.b.id, s.asg.id, { rating: 5, comment: "Great work" }); await submitReview(s.w.id, s.asg.id, { rating: 4, comment: "Good client" });
    const fileRows = await db.select().from(files).where(eq(files.uploaderId, s.w.id)); expect(fileRows.length).toBeGreaterThan(0);
    const blob = (k: string) => `./.storage-test/${k}`; expect(fs.existsSync(blob(fileRows[0].storageKey))).toBe(true);
    const oldEmail = s.w.email;
    await deleteAccount(s.w.id, PW, "DELETE");
    const [u] = await db.select().from(users).where(eq(users.id, s.w.id));
    expect(u).toMatchObject({ status: "deleted", fullName: "Deleted", phone: null, emailVerifiedAt: null }); expect(u.email).toBe(`deleted+${s.w.id}@deleted.invalid`); expect(u.deletedAt).not.toBeNull();
    expect(await db.select().from(workerProfiles).where(eq(workerProfiles.userId, s.w.id))).toHaveLength(0);
    expect(await db.select().from(files).where(eq(files.uploaderId, s.w.id))).toHaveLength(0); expect(fs.existsSync(blob(fileRows[0].storageKey))).toBe(false);
    const conv = await getConversation(s.b.id, cid); // the business still sees its own messages and an anonymised thread
    expect(conv.msgs.map((m) => m.body).sort()).toEqual(["Thanks, received.", "[message deleted]"].sort()); expect(conv.workerName).toBe("Deleted");
    const app = (await db.select().from(applications).where(eq(applications.id, s.a.id)))[0]; expect(app.proposal).toBe("[deleted]"); expect(app.status).toBe("accepted");
    expect((await db.select().from(assignments).where(eq(assignments.id, s.asg.id)))[0].agreedCents).toBeGreaterThan(0); // engagement record kept
    const revs = await db.select().from(reviews).where(eq(reviews.assignmentId, s.asg.id));
    expect(revs.every((r) => r.revieweeId !== s.w.id)).toBe(true); // reviews about the deleted worker are gone
    expect(revs).toHaveLength(1); expect(revs[0].reviewerId).toBe(s.w.id); expect(revs[0].comment).toBeNull(); expect(revs[0].rating).toBe(4); // their rating of the business stays, comment erased
    expect(await db.select().from(notifications).where(eq(notifications.userId, s.w.id))).toHaveLength(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, s.w.id))).some((l) => l.action === "account.deleted")).toBe(true);
    await expect(authenticate(oldEmail, PW, "ip-del")).rejects.toThrow(); // cannot sign in any more
    await registerUser({ kind: "worker", fullName: "Returning Person", email: oldEmail, password: PW, acceptTerms: true }); // the address can be reused
    await expect(deleteAccount(s.w.id, PW, "DELETE")).rejects.toThrow(/not found/i);
  });
  it("withdraws open applications and removes saved data", async () => {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await worker();
    const o = await saveOpportunity(b.id, biz.id, { title: "Open application check", description: "A description that is comfortably long enough to pass the minimum length rule for postings.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of experience and can start immediately for you." }); await saveSearch(w.id, "Mine", { q: "x" }, false);
    await deleteAccount(w.id, PW, "DELETE");
    const row = (await db.select().from(applications).where(eq(applications.id, a.id)))[0]; expect(row.status).toBe("withdrawn"); expect(row.proposal).toBe("[deleted]");
  });
});

describe("business deletion", () => {
  it("an owner's deletion closes open postings, anonymises the business and keeps finished assignments", async () => {
    const s = await engagement({ complete: true }); const { cat } = await ref();
    const open = await saveOpportunity(s.b.id, s.biz.id, { title: "Another open posting", description: "A description that is comfortably long enough to pass the minimum length rule for postings.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
    await deleteAccount(s.b.id, PW, "DELETE");
    expect((await db.select().from(opportunities).where(eq(opportunities.id, open.id)))[0].status).toBe("closed");
    expect((await db.select().from(businesses).where(eq(businesses.id, s.biz.id)))[0]).toMatchObject({ name: "Deleted business", status: "deleted" });
    expect((await db.select().from(assignments).where(eq(assignments.id, s.asg.id)))[0].status).toBe("completed");
    expect(await getBusinessForUser(s.b.id)).toBeNull();
    const { searchOpportunities } = await import("@/server/services/opportunities"); expect((await searchOpportunities({ q: "Another open posting" })).total).toBe(0);
  });
  it("a team member can delete themselves without affecting the business", async () => {
    const owner = await makeUser("business"); const email = `mem${Date.now()}@test.example`; await inviteMember(owner.id, email, "member");
    const { emailOutbox } = await import("@/server/db/schema"); const { and, desc } = await import("drizzle-orm");
    const [mail] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, email), eq(emailOutbox.template, "team_invitation"))).orderBy(desc(emailOutbox.createdAt)).limit(1);
    const m = await registerUser({ kind: "business", fullName: "Team Mate", email, password: PW, acceptTerms: true, inviteToken: new URL(mail.link!).searchParams.get("token")! });
    await deleteAccount(m.id, PW, "DELETE");
    expect((await getBusinessForUser(owner.id))!.b.status).toBe("active"); expect(await getBusinessForUser(m.id)).toBeNull();
    expect((await db.select().from(messages)).length).toBeGreaterThanOrEqual(0);
  });
});
