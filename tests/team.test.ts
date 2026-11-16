import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, businessInvitations, businessMembers, businesses, emailOutbox, skills, users } from "@/server/db/schema";
import { acceptInvite, changeRole, getTeam, inviteMember, previewInvite, removeMember, resendInvite, revokeInvite } from "@/server/services/team";
import { registerUser } from "@/server/services/identity";
import { getBusinessForUser, saveBusinessProfile, submitBusinessVerification } from "@/server/services/business";
import { saveOpportunity, setOpportunityStatus } from "@/server/services/opportunities";
import { applyToOpportunity, businessSetApplicationStatus, saveBusinessNote } from "@/server/services/applications";
import { inviteWorker, shortlistWorker } from "@/server/services/relationships";
import { businessAction } from "@/server/services/assignments";
import { proposeSlices } from "@/server/services/coverage";
import { getConversation, sendMessage, startConversation } from "@/server/services/messaging";
import { saveAbout, savePreferences, saveAvailability, completeOnboarding } from "@/server/services/worker";
import { closeDb, freshDb, makeUser, ref } from "./helpers";
import { applications, assignments } from "@/server/db/schema";

beforeAll(freshDb);
afterAll(closeDb);

const post = (cat: string, o: Record<string, unknown> = {}) => ({ title: "Weekly bookkeeping support", description: "Keep our books current by entering invoices and reconciling the bank feed each week.", engagementType: "micro_task", categoryId: cat, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40, ...o });
let n = 0;
async function tokenFor(email: string) {
  const [m] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.toEmail, email), eq(emailOutbox.template, "team_invitation"))).orderBy(desc(emailOutbox.createdAt)).limit(1);
  return new URL(m.link!).searchParams.get("token")!;
}
/** Owner + a manager + a member, all joined through the real invitation → registration path. */
async function team() {
  const owner = await makeUser("business"); const biz = (await getBusinessForUser(owner.id))!.b;
  const join = async (role: "manager" | "member") => {
    const email = `team${Date.now()}${n++}@test.example`;
    await inviteMember(owner.id, email, role);
    const u = await registerUser({ kind: "business", fullName: `Person ${role}`, email, password: "CorrectHorse9", acceptTerms: true, inviteToken: await tokenFor(email) });
    return u;
  };
  return { owner, biz, manager: await join("manager"), member: await join("member"), join };
}
async function worker() {
  const w = await makeUser("worker"); const sk = await db.select().from(skills);
  await saveAbout(w.id, { headline: "Bookkeeper", summary: "I keep small-business books tidy and accurate for busy owners.", experienceLevel: "intermediate", skillIds: [sk[0].id] });
  await savePreferences(w.id, { arrangements: ["remote"], publicProfile: true }); await saveAvailability(w.id, { windows: [{ weekday: 1, startMinute: 540, endMinute: 900 }] }); await completeOnboarding(w.id); return w;
}

describe("joining a team", () => {
  it("registering through an invitation joins the existing business (no new business), verifies the email, and records the role", async () => {
    const { owner, biz, manager, member } = await team();
    const t = await getTeam(owner.id);
    expect(t.members.map((m) => m.role).sort()).toEqual(["manager", "member", "owner"]);
    expect((await db.select().from(businesses).where(eq(businesses.id, biz.id))).length).toBe(1);
    expect((await getBusinessForUser(manager.id))!.b.id).toBe(biz.id);
    expect((await db.select().from(users).where(eq(users.id, member.id)))[0].emailVerifiedAt).not.toBeNull();
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.actorId, member.id), eq(auditLogs.action, "team.joined")))).length).toBe(1);
  });
  it("stores only token hashes and the token works once", async () => {
    const owner = await makeUser("business"); const email = `once${n++}@test.example`;
    await inviteMember(owner.id, email, "member"); const token = await tokenFor(email);
    expect((await db.select().from(businessInvitations)).every((i) => /^[a-f0-9]{64}$/.test(i.tokenHash))).toBe(true);
    await registerUser({ kind: "business", fullName: "First Use", email, password: "CorrectHorse9", acceptTerms: true, inviteToken: token });
    expect(await previewInvite(token)).toBeNull();
    await expect(registerUser({ kind: "business", fullName: "Second Use", email, password: "CorrectHorse9", acceptTerms: true, inviteToken: token })).rejects.toThrow();
  });
  it("the invited email must match; workers can't use invitations; invalid tokens fail", async () => {
    const owner = await makeUser("business"); const email = `match${n++}@test.example`; await inviteMember(owner.id, email, "member"); const token = await tokenFor(email);
    await expect(registerUser({ kind: "business", fullName: "Other P", email: `other${n++}@test.example`, password: "CorrectHorse9", acceptTerms: true, inviteToken: token })).rejects.toThrow(/email address the invitation was sent to/);
    await expect(registerUser({ kind: "worker", fullName: "Wrong K", email, password: "CorrectHorse9", acceptTerms: true, inviteToken: token })).rejects.toThrow(/business accounts/);
    await expect(registerUser({ kind: "business", fullName: "Bad T", email, password: "CorrectHorse9", acceptTerms: true, inviteToken: "x".repeat(30) })).rejects.toThrow(/invalid, expired/);
  });
  it("expired and revoked invitations can't be used", async () => {
    const owner = await makeUser("business"); const e1 = `exp${n++}@test.example`, e2 = `rev${n++}@test.example`;
    await inviteMember(owner.id, e1, "member"); await inviteMember(owner.id, e2, "member");
    const t1 = await tokenFor(e1), t2 = await tokenFor(e2);
    await db.update(businessInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(businessInvitations.email, e1));
    const inv2 = (await getTeam(owner.id)).invites.find((i) => i.email === e2)!; await revokeInvite(owner.id, inv2.id);
    expect(await previewInvite(t1)).toBeNull(); expect(await previewInvite(t2)).toBeNull();
  });
  it("an existing business user without a team (e.g. removed earlier) can accept; one who already has a team cannot; wrong email cannot", async () => {
    const A = await makeUser("business"); const loner = await makeUser("business"); const other = await makeUser("business");
    await db.delete(businessMembers).where(eq(businessMembers.userId, loner.id)); // simulate an account that left its business
    await inviteMember(A.id, loner.email, "manager"); const token = await tokenFor(loner.email);
    await expect(acceptInvite(other.id, token)).rejects.toThrow(/different email/);
    await acceptInvite(loner.id, token);
    expect((await getBusinessForUser(loner.id))!.role).toBe("manager");
    // `other` already belongs to a business, so inviting them is refused up front
    await expect(inviteMember(A.id, other.email, "member")).rejects.toThrow(/already belongs to another business/);
  });
  it("only business emails can be invited; duplicates and existing members are refused; managers can't invite managers", async () => {
    const { owner, manager, member } = await team(); const w = await makeUser("worker");
    await expect(inviteMember(owner.id, w.email, "member")).rejects.toThrow(/different kind of account/);
    await expect(inviteMember(owner.id, member.email, "member")).rejects.toThrow(/already on your team/);
    const email = `dup${n++}@test.example`; await inviteMember(owner.id, email, "member");
    await expect(inviteMember(owner.id, email, "member")).rejects.toThrow(/open invitation/);
    await expect(inviteMember(manager.id, `m${n++}@test.example`, "manager")).rejects.toThrow(/Only an owner can invite managers/);
    await inviteMember(manager.id, `m${n++}@test.example`, "member");
    await expect(inviteMember(member.id, `x${n++}@test.example`, "member")).rejects.toThrow(/can’t invite/);
    await expect(inviteMember(owner.id, "not-an-email", "member")).rejects.toThrow();
    await expect(inviteMember(owner.id, `o${n++}@test.example`, "owner")).rejects.toThrow(); // owners can't be invited
  });
  it("resend replaces the old link", async () => {
    const owner = await makeUser("business"); const email = `rs${n++}@test.example`; await inviteMember(owner.id, email, "member"); const old = await tokenFor(email);
    await resendInvite(owner.id, (await getTeam(owner.id)).invites[0].id);
    expect(await previewInvite(old)).toBeNull(); expect(await previewInvite(await tokenFor(email))).not.toBeNull();
  });
});

describe("roles are enforced on every write path", () => {
  it("members are read-only: cannot post, edit the business, hire, message-manage, cover, review or manage the team", async () => {
    const { owner, biz, member } = await team(); const { cat } = await ref(); const w = await worker();
    const o = await saveOpportunity(owner.id, biz.id, post(cat.id), { publish: true });
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start right away." });
    const denied = /Your role \(member\)/;
    await expect(saveOpportunity(member.id, biz.id, post(cat.id), { publish: true })).rejects.toThrow(denied);
    await expect(saveOpportunity(member.id, biz.id, post(cat.id), { publish: false })).rejects.toThrow(denied);
    await expect(setOpportunityStatus(member.id, biz.id, o.id, "closed")).rejects.toThrow(denied);
    await expect(saveBusinessProfile(member.id, biz.id, { name: "Hijacked" })).rejects.toThrow(denied);
    await expect(submitBusinessVerification(member.id, biz.id, "Registry number 12345 and website")).rejects.toThrow(/Your role/);
    await expect(businessSetApplicationStatus(member.id, a.id, "shortlisted")).rejects.toThrow(denied);
    await expect(saveBusinessNote(member.id, a.id, "my note")).rejects.toThrow(denied);
    await expect(shortlistWorker(member.id, w.id)).rejects.toThrow(denied);
    await expect(inviteWorker(member.id, o.id, w.id)).rejects.toThrow(denied);
    await expect(proposeSlices(member.id, o.id, [{ workerId: w.id, weekday: 1, startMinute: 600, endMinute: 660 }])).rejects.toThrow(denied);
    await expect(changeRole(member.id, owner.id, "member")).rejects.toThrow(/Only an owner/);
    expect((await db.select().from(businesses).where(eq(businesses.id, biz.id)))[0].name).not.toBe("Hijacked");
    expect((await db.select().from(applications).where(eq(applications.id, a.id)))[0].status).toBe("submitted"); // the member's attempt changed nothing
  });
  it("members can read, and message people the business already has a relationship with", async () => {
    const { owner, biz, member } = await team(); const { cat } = await ref(); const w = await worker();
    const o = await saveOpportunity(owner.id, biz.id, post(cat.id), { publish: true });
    await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start right away." });
    expect((await getBusinessForUser(member.id))!.b.id).toBe(biz.id);
    const cid = await startConversation(member.id, w.id); await sendMessage(member.id, cid, "Thanks for applying — a manager will review shortly.");
    expect((await getConversation(owner.id, cid)).msgs).toHaveLength(1); // same thread is visible to the whole team
  });
  it("managers do everything operational (post, hire, assignments, coverage, reviews) but not verification or team management", async () => {
    const { owner, biz, manager } = await team(); const { cat } = await ref(); const w = await worker();
    const o = await saveOpportunity(manager.id, biz.id, post(cat.id), { publish: true });
    const a = await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of bookkeeping experience and can start right away." });
    await businessSetApplicationStatus(manager.id, a.id, "offer_received");
    const { workerSetApplicationStatus } = await import("@/server/services/applications"); await workerSetApplicationStatus(w.id, a.id, "accepted");
    const asg = (await db.select().from(assignments).where(eq(assignments.applicationId, a.id)))[0];
    await businessAction(manager.id, asg.id, "cancel", "Project postponed to next quarter");
    await saveBusinessProfile(manager.id, biz.id, { name: biz.name, industry: "Retail" });
    await expect(submitBusinessVerification(manager.id, biz.id, "Registry number 12345 and website")).rejects.toThrow(/Your role \(manager\)/);
    await expect(changeRole(manager.id, owner.id, "member")).rejects.toThrow(/Only an owner/);
    await submitBusinessVerification(owner.id, biz.id, "Registry number 12345 and website");
  });
  it("a different business's team (even its owner) gets not-found, not forbidden, and cannot touch this team", async () => {
    const A = await team(); const B = await team(); const { cat } = await ref();
    const o = await saveOpportunity(A.owner.id, A.biz.id, post(cat.id), { publish: true });
    await expect(saveOpportunity(B.owner.id, A.biz.id, post(cat.id), { publish: true })).rejects.toThrow(/do not have access/);
    await expect(setOpportunityStatus(B.owner.id, B.biz.id, o.id, "closed")).rejects.toThrow(/not found/i);
    await expect(removeMember(B.owner.id, A.member.id)).rejects.toThrow(/not found/i);
    await expect(changeRole(B.owner.id, A.member.id, "manager")).rejects.toThrow(/not found/i);
    expect((await getTeam(A.owner.id)).members).toHaveLength(3);
  });
});

describe("managing the team", () => {
  it("only an owner changes roles; the owner can't be changed; role changes are audited and take effect immediately", async () => {
    const { owner, biz, member } = await team(); const { cat } = await ref();
    await expect(saveOpportunity(member.id, biz.id, post(cat.id), { publish: true })).rejects.toThrow();
    await changeRole(owner.id, member.id, "manager");
    await saveOpportunity(member.id, biz.id, post(cat.id), { publish: true }); // now allowed, no re-login needed
    await expect(changeRole(owner.id, owner.id, "member")).rejects.toThrow(/owner’s role/);
    await changeRole(owner.id, member.id, "member");
    await expect(saveOpportunity(member.id, biz.id, post(cat.id), { publish: true })).rejects.toThrow();
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.actorId, owner.id), eq(auditLogs.action, "team.role_changed")))).length).toBe(2);
  });
  it("removal rules: owner removes anyone but themselves; managers remove members only; people can leave; the owner can't", async () => {
    const { owner, manager, member, join } = await team(); const m2 = await join("member"); const mgr2 = await join("manager");
    await expect(removeMember(member.id, m2.id)).rejects.toThrow(/can’t remove/);
    await expect(removeMember(manager.id, mgr2.id)).rejects.toThrow(/can’t remove/);
    await expect(removeMember(manager.id, owner.id)).rejects.toThrow(/owner can’t be removed/);
    await expect(removeMember(owner.id, owner.id)).rejects.toThrow(/owner can’t be removed/);
    await removeMember(manager.id, m2.id); await removeMember(owner.id, mgr2.id); await removeMember(member.id, member.id); // leave
    expect((await getTeam(owner.id)).members.map((m) => m.role)).toEqual(["owner", "manager"]);
    expect(await getBusinessForUser(member.id)).toBeNull();
    await expect(getTeam(member.id)).rejects.toThrow(/not part of a business/);
  });
  it("database invariants: exactly one owner per business and one business per person", async () => {
    const { biz, member } = await team(); const other = await makeUser("business");
    await expect(db.insert(businessMembers).values({ businessId: biz.id, userId: member.id, role: "member" })).rejects.toThrow();
    const o2 = await makeUser("business"); await db.delete(businessMembers).where(eq(businessMembers.userId, o2.id));
    await expect(db.insert(businessMembers).values({ businessId: biz.id, userId: o2.id, role: "owner" })).rejects.toThrow(); // second owner
    await expect(db.insert(businessMembers).values({ businessId: (await getBusinessForUser(other.id))!.b.id, userId: member.id, role: "member" })).rejects.toThrow();
  });
  it("pending invitations are visible to the team with expiry state", async () => {
    const { owner } = await team(); await inviteMember(owner.id, `pend${n++}@test.example`, "member");
    const t = await getTeam(owner.id); expect(t.invites).toHaveLength(1); expect(t.invites[0].expired).toBe(false);
  });
});
