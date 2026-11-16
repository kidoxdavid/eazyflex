import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { applications, assignments, coverageSlices, businessMembers, businesses, conversations, messageReports, messages, opportunities, users, workerInvitations } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { rateLimit } from "../rate-limit";
import { ServiceError } from "./identity";
import { attachmentsFor, saveUploads, safeName, type Upload } from "./files";
import { privateName } from "./matching";

const CONTACT = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|((?:\+?\d[\s().-]?){9,})|(https?:\/\/(?:wa\.me|t\.me|api\.whatsapp\.com)\S*)/i;

type Side = { side: "worker"; workerId: string } | { side: "business"; businessId: string };
async function sideOf(userId: string): Promise<Side> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.status !== "active") throw new ServiceError("Account not active", "forbidden");
  if (u.kind === "worker") return { side: "worker", workerId: userId };
  if (u.kind === "business") {
    const [m] = await db.select().from(businessMembers).where(eq(businessMembers.userId, userId)).limit(1);
    if (m) return { side: "business", businessId: m.businessId };
  }
  throw new ServiceError("Messaging is available to workers and businesses", "forbidden");
}

/** A conversation may exist only where there is a real relationship: application, invitation or assignment. */
async function hasRelationship(businessId: string, workerId: string) {
  const [a] = await db.select({ id: applications.id }).from(applications).innerJoin(opportunities, eq(opportunities.id, applications.opportunityId)).where(and(eq(opportunities.businessId, businessId), eq(applications.workerId, workerId))).limit(1);
  if (a) return true;
  const [i] = await db.select({ id: workerInvitations.id }).from(workerInvitations).where(and(eq(workerInvitations.businessId, businessId), eq(workerInvitations.workerId, workerId))).limit(1);
  if (i) return true;
  const [s] = await db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.businessId, businessId), eq(assignments.workerId, workerId))).limit(1);
  if (s) return true;
  const [c] = await db.select({ id: coverageSlices.id }).from(coverageSlices).innerJoin(opportunities, eq(opportunities.id, coverageSlices.opportunityId)).where(and(eq(opportunities.businessId, businessId), eq(coverageSlices.workerId, workerId))).limit(1);
  return !!c;
}
async function hasConfirmedAssignment(businessId: string, workerId: string) {
  const [s] = await db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.businessId, businessId), eq(assignments.workerId, workerId), sql`${assignments.status} <> 'cancelled'`)).limit(1);
  if (s) return true;
  const [c] = await db.select({ id: coverageSlices.id }).from(coverageSlices).innerJoin(opportunities, eq(opportunities.id, coverageSlices.opportunityId)).where(and(eq(opportunities.businessId, businessId), eq(coverageSlices.workerId, workerId), eq(coverageSlices.status, "confirmed"))).limit(1);
  return !!c;
}

export async function startConversation(userId: string, counterpartId: string, opportunityId?: string) {
  const me = await sideOf(userId);
  let businessId: string, workerId: string;
  if (me.side === "business") { businessId = me.businessId; workerId = counterpartId; } else { workerId = me.workerId; businessId = counterpartId; }
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const [w] = await db.select().from(users).where(and(eq(users.id, workerId), eq(users.kind, "worker"))).limit(1);
  if (!b || !w || !(await hasRelationship(businessId, workerId))) throw new ServiceError("You can message someone once there is an application, invitation or assignment between you", "forbidden");
  const [existing] = await db.select().from(conversations).where(and(eq(conversations.businessId, businessId), eq(conversations.workerId, workerId))).limit(1);
  if (existing) return existing.id;
  const [c] = await db.insert(conversations).values({ businessId, workerId, opportunityId: opportunityId ?? null }).returning();
  return c.id;
}

async function loadForParticipant(userId: string, conversationId: string) {
  const me = await sideOf(userId);
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const ok = c && (me.side === "worker" ? c.workerId === me.workerId : c.businessId === me.businessId);
  if (!ok) throw new ServiceError("Conversation not found", "not_found"); // non-participants learn nothing
  return { c, me };
}

export async function sendMessage(userId: string, conversationId: string, bodyRaw: string, uploads: Upload[] = []) {
  const { c, me } = await loadForParticipant(userId, conversationId);
  let body = bodyRaw.trim();
  if (!body && uploads.length) body = "📎 Attachment";
  if (!body) throw new ServiceError("Write a message first");
  if (body.length > 4000) throw new ServiceError("Message is too long (4000 characters max)");
  if (!(await rateLimit(`msg:${userId}`, 30, 60))) throw new ServiceError("You are sending messages too quickly", "rate_limited");
  if ((CONTACT.test(body) || uploads.some((u) => CONTACT.test(safeName(u.name)))) && !(await hasConfirmedAssignment(c.businessId, c.workerId)))
    throw new ServiceError("For everyone’s safety, phone numbers, emails and external chat links can be shared only after an assignment is confirmed.");
  const { validateUpload } = await import("./files");
  uploads.forEach(validateUpload); // reject bad files before anything is written
  let messageId = "";
  await db.transaction(async (tx) => {
    [{ id: messageId }] = await tx.insert(messages).values({ conversationId, senderId: userId, body }).returning({ id: messages.id });
    await tx.update(conversations).set({ lastMessageAt: new Date(), ...(me.side === "worker" ? { workerLastReadAt: new Date() } : { businessLastReadAt: new Date() }) }).where(eq(conversations.id, conversationId));
  });
  if (uploads.length) await saveUploads(userId, uploads, { messageId }).catch(async (e) => { await db.delete(messages).where(eq(messages.id, messageId)); throw e; });
  if (me.side === "worker") {
    const owners = await db.select({ u: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, c.businessId));
    for (const o of owners) await notify(o.u, "message", "New message", "You have a new message.", `/business/messages/${c.id}`);
  } else await notify(c.workerId, "message", "New message", "You have a new message.", `/worker/messages/${c.id}`);
}

export async function getConversation(userId: string, conversationId: string) {
  const { c, me } = await loadForParticipant(userId, conversationId);
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt).limit(500);
  await db.update(conversations).set(me.side === "worker" ? { workerLastReadAt: new Date() } : { businessLastReadAt: new Date() }).where(eq(conversations.id, conversationId));
  const [b] = await db.select().from(businesses).where(eq(businesses.id, c.businessId));
  const [w] = await db.select().from(users).where(eq(users.id, c.workerId));
  const atts = await attachmentsFor({ messageIds: msgs.map((m) => m.id) });
  return { c, me: me.side, msgs: msgs.map((m) => ({ ...m, attachments: atts.filter((a) => a.messageId === m.id) })), businessName: b.name, workerName: me.side === "business" ? privateName(w.fullName) : w.fullName };
}

export async function listConversations(userId: string) {
  const me = await sideOf(userId);
  const rows = await db.select({ c: conversations, b: businesses.name, w: users.fullName }).from(conversations)
    .innerJoin(businesses, eq(businesses.id, conversations.businessId)).innerJoin(users, eq(users.id, conversations.workerId))
    .where(me.side === "worker" ? eq(conversations.workerId, me.workerId) : eq(conversations.businessId, me.businessId)).orderBy(desc(conversations.lastMessageAt));
  return rows.map((r) => {
    const lastRead = me.side === "worker" ? r.c.workerLastReadAt : r.c.businessLastReadAt;
    return { id: r.c.id, title: me.side === "worker" ? r.b : privateName(r.w), lastMessageAt: r.c.lastMessageAt, unread: !lastRead || lastRead < r.c.lastMessageAt };
  });
}

export async function reportMessage(userId: string, messageId: string, reason: string) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!m) throw new ServiceError("Message not found", "not_found");
  await loadForParticipant(userId, m.conversationId); // must be a participant
  if (m.senderId === userId) throw new ServiceError("You cannot report your own message");
  if (reason.trim().length < 5) throw new ServiceError("Tell us briefly what is wrong");
  await db.insert(messageReports).values({ messageId, reporterId: userId, reason: reason.slice(0, 500) }).onConflictDoNothing();
  await audit(userId, "message.reported", "message", messageId);
}
export const _or = or;
