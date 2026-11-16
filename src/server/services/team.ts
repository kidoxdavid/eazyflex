import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { businessInvitations, businessMembers, businesses, sessions, users } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { sendEmail } from "../email";
import { rateLimit } from "../rate-limit";
import { hashToken, newToken } from "../auth/tokens";
import { canBiz, type BizRole } from "../business-rbac";
import { ServiceError } from "./identity";
import { brand } from "@/lib/brand";

const INVITE_DAYS = 7;
async function membership(userId: string) {
  const [m] = await db.select({ m: businessMembers, b: businesses }).from(businessMembers).innerJoin(businesses, eq(businesses.id, businessMembers.businessId)).where(eq(businessMembers.userId, userId)).limit(1);
  if (!m) throw new ServiceError("You are not part of a business", "forbidden");
  return m;
}

export async function getTeam(userId: string) {
  const me = await membership(userId);
  const [members, invites] = await Promise.all([
    db.select({ userId: users.id, name: users.fullName, email: users.email, role: businessMembers.role, status: users.status }).from(businessMembers).innerJoin(users, eq(users.id, businessMembers.userId)).where(eq(businessMembers.businessId, me.b.id)).orderBy(asc(businessMembers.role), asc(users.fullName)),
    db.select().from(businessInvitations).where(and(eq(businessInvitations.businessId, me.b.id), isNull(businessInvitations.acceptedAt), isNull(businessInvitations.revokedAt))).orderBy(businessInvitations.createdAt),
  ]);
  return { business: me.b, myRole: me.m.role as BizRole, members, invites: invites.map((i) => ({ ...i, expired: i.expiresAt < new Date() })) };
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const roleSchema = z.enum(["manager", "member"]);

async function createInviteToken(businessId: string, email: string, role: "manager" | "member", invitedBy: string, businessName: string) {
  const token = newToken();
  await db.insert(businessInvitations).values({ businessId, email, role, tokenHash: hashToken(token), invitedBy, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });
  await sendEmail({ to: email, template: "team_invitation", subject: `You’re invited to join ${businessName} on ${brand.name}`, body: `${businessName} invited you to join their team as a ${role}. The invitation is valid for ${INVITE_DAYS} days. If you weren’t expecting it, ignore this email.`, path: `/join-team?token=${token}` });
}

export async function inviteMember(userId: string, emailRaw: string, roleRaw: string) {
  const me = await membership(userId);
  if (!canBiz(me.m.role, "team.invite")) throw new ServiceError("Your role can’t invite people. Ask an owner or manager.", "forbidden");
  const email = emailSchema.parse(emailRaw); const role = roleSchema.parse(roleRaw);
  if (role === "manager" && !canBiz(me.m.role, "team.manage")) throw new ServiceError("Only an owner can invite managers. You can invite members.", "forbidden");
  if (!(await rateLimit(`team-invite:${me.b.id}`, 20, 86400))) throw new ServiceError("Daily invitation limit reached", "rate_limited");
  const [existing] = await db.select({ u: users, m: businessMembers.businessId }).from(users).leftJoin(businessMembers, eq(businessMembers.userId, users.id)).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) {
    if (existing.u.kind !== "business") throw new ServiceError("That email belongs to a different kind of account and can’t join a business team.");
    if (existing.m) throw new ServiceError(existing.m === me.b.id ? "That person is already on your team" : "That person already belongs to another business", "conflict");
  }
  try { await createInviteToken(me.b.id, email, role, userId, me.b.name); }
  catch (e: any) { if (e?.cause?.code === "23505" || e?.code === "23505") throw new ServiceError("There is already an open invitation for that email. Revoke or resend it from the list.", "conflict"); throw e; }
  await audit(userId, "team.invited", "business", me.b.id, { email, role });
}

export async function previewInvite(token: string) {
  const [i] = await db.select({ i: businessInvitations, name: businesses.name }).from(businessInvitations).innerJoin(businesses, eq(businesses.id, businessInvitations.businessId))
    .where(and(eq(businessInvitations.tokenHash, hashToken(token)), isNull(businessInvitations.acceptedAt), isNull(businessInvitations.revokedAt), gt(businessInvitations.expiresAt, new Date()))).limit(1);
  return i ? { id: i.i.id, businessId: i.i.businessId, businessName: i.name, email: i.i.email, role: i.i.role as "manager" | "member" } : null;
}

/** Existing signed-in business user without a team accepts an invitation addressed to their email. */
export async function acceptInvite(userId: string, token: string) {
  const inv = await previewInvite(token);
  if (!inv) throw new ServiceError("This invitation is invalid, expired or was withdrawn", "not_found");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.kind !== "business" || u.status !== "active") throw new ServiceError("Only business accounts can join a team", "forbidden");
  if (u.email.toLowerCase() !== inv.email) throw new ServiceError("This invitation was sent to a different email address. Sign in with that address.", "forbidden");
  const [has] = await db.select().from(businessMembers).where(eq(businessMembers.userId, userId)).limit(1);
  if (has) throw new ServiceError("You already belong to a business. A person can belong to one business.", "conflict");
  await db.transaction(async (tx) => {
    const claimed = await tx.update(businessInvitations).set({ acceptedAt: new Date() }).where(and(eq(businessInvitations.id, inv.id), isNull(businessInvitations.acceptedAt), isNull(businessInvitations.revokedAt))).returning({ id: businessInvitations.id });
    if (!claimed.length) throw new ServiceError("This invitation was just used or withdrawn", "conflict");
    await tx.insert(businessMembers).values({ businessId: inv.businessId, userId, role: inv.role });
    await audit(userId, "team.joined", "business", inv.businessId, { role: inv.role }, tx);
  });
  const [owner] = await db.select({ u: businessMembers.userId }).from(businessMembers).where(and(eq(businessMembers.businessId, inv.businessId), eq(businessMembers.role, "owner")));
  if (owner) await notify(owner.u, "team", "Team member joined", `${u.fullName} joined your team as ${inv.role}.`, "/business/team");
  return inv.businessId;
}

export async function revokeInvite(userId: string, inviteId: string) {
  const me = await membership(userId);
  const [i] = await db.select().from(businessInvitations).where(and(eq(businessInvitations.id, inviteId), eq(businessInvitations.businessId, me.b.id))).limit(1);
  if (!i) throw new ServiceError("Invitation not found", "not_found");
  if (!canBiz(me.m.role, "team.invite") || (i.role === "manager" && !canBiz(me.m.role, "team.manage"))) throw new ServiceError("Your role can’t withdraw this invitation", "forbidden");
  if (i.acceptedAt || i.revokedAt) throw new ServiceError("This invitation is already closed");
  await db.update(businessInvitations).set({ revokedAt: new Date() }).where(eq(businessInvitations.id, inviteId));
  await audit(userId, "team.invite_revoked", "business", me.b.id, { email: i.email });
}
export async function resendInvite(userId: string, inviteId: string) {
  const me = await membership(userId);
  const [i] = await db.select().from(businessInvitations).where(and(eq(businessInvitations.id, inviteId), eq(businessInvitations.businessId, me.b.id))).limit(1);
  if (!i) throw new ServiceError("Invitation not found", "not_found");
  await revokeInvite(userId, inviteId);
  await inviteMember(userId, i.email, i.role);
}

export async function changeRole(userId: string, targetUserId: string, roleRaw: string) {
  const me = await membership(userId);
  if (!canBiz(me.m.role, "team.manage")) throw new ServiceError("Only an owner can change roles", "forbidden");
  const role = roleSchema.parse(roleRaw);
  const [t] = await db.select().from(businessMembers).where(and(eq(businessMembers.userId, targetUserId), eq(businessMembers.businessId, me.b.id))).limit(1);
  if (!t) throw new ServiceError("Team member not found", "not_found");
  if (t.role === "owner") throw new ServiceError("The owner’s role can’t be changed");
  if (t.role === role) return;
  await db.update(businessMembers).set({ role }).where(and(eq(businessMembers.userId, targetUserId), eq(businessMembers.businessId, me.b.id)));
  await audit(userId, "team.role_changed", "user", targetUserId, { from: t.role, to: role });
  await notify(targetUserId, "team", "Your role changed", `Your role at ${me.b.name} is now ${role}.`, "/business/team");
}

/** Remove someone (owner: managers and members; manager: members) or leave the team yourself (manager/member). The owner cannot leave. */
export async function removeMember(userId: string, targetUserId: string) {
  const me = await membership(userId);
  const [t] = await db.select().from(businessMembers).where(and(eq(businessMembers.userId, targetUserId), eq(businessMembers.businessId, me.b.id))).limit(1);
  if (!t) throw new ServiceError("Team member not found", "not_found");
  if (t.role === "owner") throw new ServiceError("The owner can’t be removed or leave the team");
  const self = targetUserId === userId;
  const allowed = self || (me.m.role === "owner") || (me.m.role === "manager" && t.role === "member");
  if (!allowed) throw new ServiceError("Your role can’t remove this person", "forbidden");
  await db.transaction(async (tx) => {
    await tx.delete(businessMembers).where(and(eq(businessMembers.userId, targetUserId), eq(businessMembers.businessId, me.b.id)));
    await audit(userId, self ? "team.left" : "team.removed", "user", targetUserId, { role: t.role }, tx);
  });
  if (!self) await notify(targetUserId, "team", "Removed from team", `You were removed from ${me.b.name}.`, "/business");
  else { const [o] = await db.select({ u: businessMembers.userId }).from(businessMembers).where(and(eq(businessMembers.businessId, me.b.id), eq(businessMembers.role, "owner"))); if (o) await notify(o.u, "team", "A team member left", "A member left your team.", "/business/team"); }
}
export const _s = sessions;
