import { randomBytes } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import * as t from "../db/schema";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { hashPassword, verifyPassword } from "../auth/password";
import { storage } from "../storage";
import { ServiceError } from "./identity";
import { privateName } from "./matching";

const ACTIVE_ASSIGNMENT = ["confirmed", "in_progress", "submitted", "changes_requested"] as const;

/**
 * "Download my data" (PIPEDA access request). Everything the person supplied or generated, plus their own activity.
 * Deliberately excluded: password hash, session/auth tokens, TOTP seed and recovery-code hashes, and other people's personal
 * information (counterparties appear only as a business name or "First L.").
 */
export async function exportUserData(userId: string) {
  if (!(await rateLimit(`export:${userId}`, 3, 86400))) throw new ServiceError("You can export your data up to 3 times per day.", "rate_limited");
  const [u] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  if (!u || u.status === "deleted") throw new ServiceError("Account not found", "not_found");
  const q = <T>(p: Promise<T>) => p;

  const base = {
    exportedAt: new Date().toISOString(), format: "openhour-export-v1",
    account: { id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, kind: u.kind, status: u.status, emailVerifiedAt: u.emailVerifiedAt, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, twoFactorEnabled: !!u.totpEnabledAt },
    consents: await q(db.select({ documentType: t.userConsents.documentType, version: t.userConsents.version, acceptedAt: t.userConsents.acceptedAt }).from(t.userConsents).where(eq(t.userConsents.userId, userId))),
    notificationPreferences: (await db.select().from(t.notificationPrefs).where(eq(t.notificationPrefs.userId, userId)))[0] ?? null,
    notifications: await q(db.select({ type: t.notifications.type, title: t.notifications.title, body: t.notifications.body, createdAt: t.notifications.createdAt, readAt: t.notifications.readAt }).from(t.notifications).where(eq(t.notifications.userId, userId))),
    verifications: await q(db.select({ type: t.verifications.type, status: t.verifications.status, decidedAt: t.verifications.decidedAt }).from(t.verifications).where(eq(t.verifications.userId, userId))),
    activityLog: await q(db.select({ action: t.auditLogs.action, entityType: t.auditLogs.entityType, at: t.auditLogs.createdAt }).from(t.auditLogs).where(eq(t.auditLogs.actorId, userId)).limit(1000)),
  };

  // Messages the person wrote, with the other party shown only as a business name or "First L."
  const convs = await db.select({ c: t.conversations, b: t.businesses.name, w: t.users.fullName }).from(t.conversations)
    .innerJoin(t.businesses, eq(t.businesses.id, t.conversations.businessId)).innerJoin(t.users, eq(t.users.id, t.conversations.workerId))
    .where(or(eq(t.conversations.workerId, userId), inArray(t.conversations.businessId, db.select({ b: t.businessMembers.businessId }).from(t.businessMembers).where(eq(t.businessMembers.userId, userId)))));
  const mine = convs.length ? await db.select().from(t.messages).where(and(inArray(t.messages.conversationId, convs.map((c) => c.c.id)), eq(t.messages.senderId, userId))) : [];
  const messages = mine.map((m) => { const c = convs.find((x) => x.c.id === m.conversationId)!; return { sentAt: m.createdAt, conversationWith: u.kind === "worker" ? c.b : privateName(c.w), body: m.body }; });

  if (u.kind === "worker") {
    const [profile] = await db.select().from(t.workerProfiles).where(eq(t.workerProfiles.userId, userId));
    const apps = await db.select({ a: t.applications, title: t.opportunities.title, business: t.businesses.name }).from(t.applications).innerJoin(t.opportunities, eq(t.opportunities.id, t.applications.opportunityId)).innerJoin(t.businesses, eq(t.businesses.id, t.opportunities.businessId)).where(eq(t.applications.workerId, userId));
    const answers = apps.length ? await db.select({ applicationId: t.applicationAnswers.applicationId, question: t.opportunityQuestions.prompt, answer: t.applicationAnswers.answer }).from(t.applicationAnswers).innerJoin(t.opportunityQuestions, eq(t.opportunityQuestions.id, t.applicationAnswers.questionId)).where(inArray(t.applicationAnswers.applicationId, apps.map((a) => a.a.id))) : [];
    const asg = await db.select({ a: t.assignments, title: t.opportunities.title, business: t.businesses.name }).from(t.assignments).innerJoin(t.opportunities, eq(t.opportunities.id, t.assignments.opportunityId)).innerJoin(t.businesses, eq(t.businesses.id, t.assignments.businessId)).where(eq(t.assignments.workerId, userId));
    const subs = asg.length ? await db.select().from(t.assignmentSubmissions).where(inArray(t.assignmentSubmissions.assignmentId, asg.map((a) => a.a.id))) : [];
    const occ = asg.length ? await db.select().from(t.assignmentOccurrences).where(inArray(t.assignmentOccurrences.assignmentId, asg.map((a) => a.a.id))) : [];
    return { ...base, messages, worker: {
      profile: profile ?? null,
      skills: (await db.select({ name: t.skills.name, years: t.workerSkills.years }).from(t.workerSkills).innerJoin(t.skills, eq(t.skills.id, t.workerSkills.skillId)).where(eq(t.workerSkills.userId, userId))),
      experience: await db.select().from(t.workerExperience).where(eq(t.workerExperience.userId, userId)),
      education: await db.select().from(t.workerEducation).where(eq(t.workerEducation.userId, userId)),
      certifications: await db.select().from(t.workerCertifications).where(eq(t.workerCertifications.userId, userId)),
      weeklyAvailability: await db.select().from(t.workerAvailability).where(eq(t.workerAvailability.userId, userId)),
      unavailableDates: await db.select().from(t.workerUnavailability).where(eq(t.workerUnavailability.userId, userId)),
      applications: apps.map((x) => ({ opportunity: x.title, business: x.business, status: x.a.status, proposal: x.a.proposal, proposedRateCents: x.a.proposedRateCents, availabilityNote: x.a.availabilityNote, submittedAt: x.a.createdAt, answers: answers.filter((a) => a.applicationId === x.a.id).map(({ question, answer }) => ({ question, answer })) })),
      savedOpportunities: (await db.select({ title: t.opportunities.title, savedAt: t.savedOpportunities.createdAt }).from(t.savedOpportunities).innerJoin(t.opportunities, eq(t.opportunities.id, t.savedOpportunities.opportunityId)).where(eq(t.savedOpportunities.userId, userId))),
      savedSearches: await db.select({ name: t.savedSearches.name, params: t.savedSearches.params, alertsEnabled: t.savedSearches.alertsEnabled }).from(t.savedSearches).where(eq(t.savedSearches.userId, userId)),
      assignments: asg.map((x) => ({ opportunity: x.title, business: x.business, status: x.a.status, payType: x.a.payType, agreedCents: x.a.agreedCents, startDate: x.a.startDate, endDate: x.a.endDate,
        submissions: subs.filter((s) => s.assignmentId === x.a.id).map((s) => ({ note: s.note, hoursWorked: s.hoursWorked, link: s.link, submittedAt: s.createdAt })),
        sessions: occ.filter((o) => o.assignmentId === x.a.id).map((o) => ({ date: o.occursOn, status: o.status, hours: o.hours, note: o.workerNote })) })),
      reviewsWritten: await db.select({ rating: t.reviews.rating, comment: t.reviews.comment, createdAt: t.reviews.createdAt }).from(t.reviews).where(eq(t.reviews.reviewerId, userId)),
      reviewsAboutYou: await db.select({ rating: t.reviews.rating, comment: t.reviews.comment }).from(t.reviews).where(and(eq(t.reviews.revieweeId, userId), eq(t.reviews.hidden, false))),
      coverageSlices: await db.select({ weekday: t.coverageSlices.weekday, startMinute: t.coverageSlices.startMinute, endMinute: t.coverageSlices.endMinute, status: t.coverageSlices.status }).from(t.coverageSlices).where(eq(t.coverageSlices.workerId, userId)),
      uploadedFiles: await db.select({ name: t.files.originalName, sizeBytes: t.files.sizeBytes, uploadedAt: t.files.createdAt }).from(t.files).where(eq(t.files.uploaderId, userId)),
    } };
  }
  const [m] = await db.select({ m: t.businessMembers, b: t.businesses }).from(t.businessMembers).innerJoin(t.businesses, eq(t.businesses.id, t.businessMembers.businessId)).where(eq(t.businessMembers.userId, userId));
  const opps = m ? await db.select({ title: t.opportunities.title, status: t.opportunities.status, engagementType: t.opportunities.engagementType, payType: t.opportunities.payType, createdAt: t.opportunities.createdAt }).from(t.opportunities).where(and(eq(t.opportunities.businessId, m.b.id), eq(t.opportunities.createdBy, userId))) : [];
  return { ...base, messages, business: m ? { role: m.m.role, business: { name: m.b.name, industry: m.b.industry, website: m.b.website, description: m.b.description, city: m.b.city }, opportunitiesYouPosted: opps, uploadedFiles: await db.select({ name: t.files.originalName, sizeBytes: t.files.sizeBytes }).from(t.files).where(eq(t.files.uploaderId, userId)) } : null };
}

/** What stops deletion right now (empty = allowed). Active commitments to other people must be finished or cancelled first. */
export async function deletionBlockers(userId: string): Promise<string[]> {
  const [u] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  if (!u) throw new ServiceError("Account not found", "not_found");
  const out: string[] = [];
  if (u.kind === "admin") return ["Administrator accounts are removed by a super administrator, not through this page."];
  if (u.kind === "worker") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.assignments).where(and(eq(t.assignments.workerId, userId), inArray(t.assignments.status, [...ACTIVE_ASSIGNMENT])));
    if (n) out.push(`You have ${n} active assignment${n > 1 ? "s" : ""}. Finish or cancel ${n > 1 ? "them" : "it"} first.`);
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(t.coverageSlices).where(and(eq(t.coverageSlices.workerId, userId), eq(t.coverageSlices.status, "confirmed")));
    if (c) out.push(`You have ${c} confirmed shift slice${c > 1 ? "s" : ""}. Give ${c > 1 ? "them" : "it"} back first.`);
  } else {
    const [m] = await db.select().from(t.businessMembers).where(eq(t.businessMembers.userId, userId));
    if (m?.role === "owner") {
      const [{ others }] = await db.select({ others: sql<number>`count(*)::int` }).from(t.businessMembers).where(and(eq(t.businessMembers.businessId, m.businessId), sql`${t.businessMembers.userId} <> ${userId}`));
      if (others) out.push("Your business still has team members. Remove them first (there is no ownership transfer yet).");
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.assignments).where(and(eq(t.assignments.businessId, m.businessId), inArray(t.assignments.status, [...ACTIVE_ASSIGNMENT])));
      if (n) out.push(`Your business has ${n} active assignment${n > 1 ? "s" : ""}. Complete or cancel ${n > 1 ? "them" : "it"} first.`);
    }
  }
  return out;
}

/**
 * Deletes the account by anonymising it in place. People who worked with you keep a record of the engagement, but it no longer
 * identifies you. Audit entries (append-only) keep only an opaque user id.
 */
export async function deleteAccount(userId: string, password: string, confirm: string) {
  const [u] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  if (!u || u.status === "deleted") throw new ServiceError("Account not found", "not_found");
  if (!(await rateLimit(`delete:${userId}`, 5, 3600))) throw new ServiceError("Too many attempts. Try again later.", "rate_limited");
  if (confirm.trim() !== "DELETE") throw new ServiceError("Type DELETE to confirm");
  if (!(await verifyPassword(u.passwordHash, password))) throw new ServiceError("Incorrect password", "auth");
  const blockers = await deletionBlockers(userId);
  if (blockers.length) throw new ServiceError(blockers.join(" "));

  const myFiles = await db.select({ key: t.files.storageKey }).from(t.files).where(eq(t.files.uploaderId, userId));
  const newHash = await hashPassword(randomBytes(32).toString("hex"));
  const oldEmail = u.email;
  await db.transaction(async (tx) => {
    const [mem] = await tx.select().from(t.businessMembers).where(eq(t.businessMembers.userId, userId));
    if (u.kind === "worker") {
      const apps = await tx.select().from(t.applications).where(eq(t.applications.workerId, userId));
      for (const a of apps.filter((x) => !["accepted", "declined", "withdrawn", "expired"].includes(x.status))) await tx.insert(t.applicationStatusHistory).values({ applicationId: a.id, fromStatus: a.status, toStatus: "withdrawn", actorId: userId, note: "Account deleted" });
      await tx.update(t.applications).set({ status: sql`case when ${t.applications.status} in ('accepted','declined','withdrawn','expired') then ${t.applications.status} else 'withdrawn' end`, proposal: "[deleted]", availabilityNote: null, matchSnapshot: null, businessNote: null }).where(eq(t.applications.workerId, userId));
      if (apps.length) await tx.delete(t.applicationAnswers).where(inArray(t.applicationAnswers.applicationId, apps.map((a) => a.id)));
      for (const tbl of [t.workerSkills, t.workerExperience, t.workerEducation, t.workerCertifications, t.workerAvailability, t.workerUnavailability, t.savedOpportunities, t.savedSearches, t.coverageSlices] as const) await tx.delete(tbl).where(eq((tbl as any).userId ?? (tbl as any).workerId, userId));
      await tx.delete(t.workerProfiles).where(eq(t.workerProfiles.userId, userId));
      await tx.delete(t.talentShortlist).where(eq(t.talentShortlist.workerId, userId));
      await tx.delete(t.workerInvitations).where(eq(t.workerInvitations.workerId, userId));
      await tx.delete(t.reviews).where(eq(t.reviews.revieweeId, userId));
    } else if (mem) {
      if (mem.role === "owner") {
        await tx.update(t.opportunities).set({ status: "closed", updatedAt: new Date() }).where(and(eq(t.opportunities.businessId, mem.businessId), inArray(t.opportunities.status, ["draft", "pending_review", "published", "paused", "rejected"])));
        await tx.update(t.businesses).set({ name: "Deleted business", description: null, website: null, contactEmail: null, industry: null, businessType: null, city: null, status: "deleted", updatedAt: new Date() }).where(eq(t.businesses.id, mem.businessId));
        await tx.delete(t.businessInvitations).where(eq(t.businessInvitations.businessId, mem.businessId));
        await tx.delete(t.talentShortlist).where(eq(t.talentShortlist.businessId, mem.businessId));
      }
      await tx.delete(t.businessMembers).where(eq(t.businessMembers.userId, userId));
    }
    // Free text the person wrote disappears; the conversation stays intact for the other party.
    await tx.update(t.messages).set({ body: "[message deleted]" }).where(eq(t.messages.senderId, userId));
    await tx.update(t.reviews).set({ comment: null }).where(eq(t.reviews.reviewerId, userId));
    await tx.update(t.assignmentSubmissions).set({ note: "[deleted]", link: null }).where(inArray(t.assignmentSubmissions.assignmentId, tx.select({ id: t.assignments.id }).from(t.assignments).where(eq(t.assignments.workerId, userId))));
    await tx.update(t.assignmentOccurrences).set({ workerNote: null }).where(inArray(t.assignmentOccurrences.assignmentId, tx.select({ id: t.assignments.id }).from(t.assignments).where(eq(t.assignments.workerId, userId))));
    await tx.delete(t.files).where(eq(t.files.uploaderId, userId));
    for (const tbl of [t.notifications, t.notificationPrefs, t.sessions, t.authTokens, t.verifications, t.mfaRecoveryCodes] as const) await tx.delete(tbl).where(eq((tbl as any).userId, userId));
    await tx.delete(t.emailOutbox).where(eq(t.emailOutbox.toEmail, oldEmail));
    await tx.update(t.users).set({ email: `deleted+${userId}@deleted.invalid`, fullName: "Deleted", phone: null, passwordHash: newHash, status: "deleted", deletedAt: new Date(), emailVerifiedAt: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, updatedAt: new Date() }).where(eq(t.users.id, userId));
    await audit(userId, "account.deleted", "user", userId, { kind: u.kind }, tx);
  });
  for (const f of myFiles) await storage.remove(f.key).catch(() => {}); // after commit; orphaned blobs are harmless, rows are gone
}
