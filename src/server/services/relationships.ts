import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { applications, businessMembers, businesses, opportunities, talentShortlist, users, workerInvitations, workerProfiles } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { rateLimit } from "../rate-limit";
import { ServiceError } from "./identity";
import { assertBusinessPermission } from "./opportunities";
import { getBusinessForUser } from "./business";
import { privateName } from "./matching";

async function assertDiscoverable(workerId: string) {
  const [w] = await db.select({ p: workerProfiles, u: users }).from(workerProfiles).innerJoin(users, eq(users.id, workerProfiles.userId)).where(eq(workerProfiles.userId, workerId)).limit(1);
  if (!w || !w.p.publicProfile || !w.p.onboardingCompletedAt || w.u.status !== "active" || !w.u.emailVerifiedAt) throw new ServiceError("Worker not found", "not_found");
  return w;
}

export async function shortlistWorker(userId: string, workerId: string, note?: string) {
  const m = await getBusinessForUser(userId);
  if (!m) throw new ServiceError("No business account", "forbidden");
  await assertBusinessPermission(userId, m.b.id, "hiring.decide");
  await assertDiscoverable(workerId);
  await db.insert(talentShortlist).values({ businessId: m.b.id, workerId, note: note?.slice(0, 500) ?? null, createdBy: userId }).onConflictDoNothing();
  await audit(userId, "shortlist.added", "user", workerId);
}
export async function removeShortlisted(userId: string, workerId: string) {
  const m = await getBusinessForUser(userId);
  if (!m) throw new ServiceError("No business account", "forbidden");
  await assertBusinessPermission(userId, m.b.id, "hiring.decide");
  await db.delete(talentShortlist).where(and(eq(talentShortlist.businessId, m.b.id), eq(talentShortlist.workerId, workerId)));
}
export async function listShortlist(userId: string) {
  const m = await getBusinessForUser(userId);
  if (!m) throw new ServiceError("No business account", "forbidden");
  const rows = await db.select({ s: talentShortlist, name: users.fullName, headline: workerProfiles.headline, pub: workerProfiles.publicProfile }).from(talentShortlist)
    .innerJoin(users, eq(users.id, talentShortlist.workerId)).innerJoin(workerProfiles, eq(workerProfiles.userId, talentShortlist.workerId)).where(eq(talentShortlist.businessId, m.b.id)).orderBy(desc(talentShortlist.createdAt));
  // A worker who later opts out of discovery disappears from the list.
  return rows.filter((r) => r.pub).map((r) => ({ workerId: r.s.workerId, displayName: privateName(r.name), headline: r.headline, note: r.s.note }));
}

export async function inviteWorker(userId: string, opportunityId: string, workerId: string, message?: string) {
  const m = await getBusinessForUser(userId);
  if (!m) throw new ServiceError("No business account", "forbidden");
  await assertBusinessPermission(userId, m.b.id, "hiring.decide");
  if (!(await rateLimit(`invite:${m.b.id}`, 20, 86400))) throw new ServiceError("Daily invitation limit reached", "rate_limited");
  const [o] = await db.select().from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.businessId, m.b.id))).limit(1);
  if (!o) throw new ServiceError("Opportunity not found", "not_found");
  if (o.status !== "published") throw new ServiceError("Only published opportunities can be invited to");
  await assertDiscoverable(workerId);
  const [applied] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.opportunityId, opportunityId), eq(applications.workerId, workerId)));
  if (applied) throw new ServiceError("This worker has already applied");
  try {
    await db.insert(workerInvitations).values({ businessId: m.b.id, opportunityId, workerId, message: message?.slice(0, 1000) ?? null, createdBy: userId });
  } catch (e: any) {
    if (e?.cause?.code === "23505" || e?.code === "23505") throw new ServiceError("You have already invited this worker to this opportunity", "conflict");
    throw e;
  }
  await notify(workerId, "invitation", "You were invited to apply", `${m.b.name} invited you to “${o.title}”.`, "/worker/invitations");
  await audit(userId, "invitation.sent", "opportunity", opportunityId, { workerId });
}

export async function listWorkerInvitations(workerId: string) {
  return db.select({ i: workerInvitations, title: opportunities.title, oppStatus: opportunities.status, businessName: businesses.name })
    .from(workerInvitations).innerJoin(opportunities, eq(opportunities.id, workerInvitations.opportunityId)).innerJoin(businesses, eq(businesses.id, workerInvitations.businessId))
    .where(eq(workerInvitations.workerId, workerId)).orderBy(desc(workerInvitations.createdAt));
}

export async function respondToInvitation(workerId: string, invitationId: string, to: "declined") {
  const [i] = await db.select().from(workerInvitations).where(and(eq(workerInvitations.id, invitationId), eq(workerInvitations.workerId, workerId))).limit(1);
  if (!i) throw new ServiceError("Invitation not found", "not_found");
  if (i.status !== "pending") throw new ServiceError("This invitation was already answered");
  await db.update(workerInvitations).set({ status: to, respondedAt: new Date() }).where(eq(workerInvitations.id, invitationId));
  const owners = await db.select({ u: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, i.businessId));
  for (const o of owners) await notify(o.u, "invitation", "Invitation declined", "A worker declined your invitation.", `/business/opportunities/${i.opportunityId}`);
}

/** Called when an invited worker applies: marks the invitation accepted. */
export async function markInvitationAccepted(workerId: string, opportunityId: string) {
  await db.update(workerInvitations).set({ status: "accepted", respondedAt: new Date() })
    .where(and(eq(workerInvitations.workerId, workerId), eq(workerInvitations.opportunityId, opportunityId), eq(workerInvitations.status, "pending")));
}
export const _sql = sql;
