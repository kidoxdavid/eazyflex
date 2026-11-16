import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assignments, conversations, messageReports, messages, reviewReports, reviews, users, businesses, businessMembers } from "../db/schema";
import { audit } from "../audit";
import { notify } from "../notify";
import { assertCan, type Actor } from "./admin";
import { ServiceError } from "./identity";

// ---------- User-facing: report a review ----------
export async function reportReview(userId: string, reviewId: string, reason: string) {
  const [r] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  if (!r || r.hidden) throw new ServiceError("Review not found", "not_found");
  if (r.revieweeId !== userId) throw new ServiceError("Review not found", "not_found"); // only the person reviewed can report it
  if (reason.trim().length < 10) throw new ServiceError("Tell us briefly what is wrong with this review (at least 10 characters)");
  await db.insert(reviewReports).values({ reviewId, reporterId: userId, reason: reason.slice(0, 500) }).onConflictDoNothing();
  await audit(userId, "review.reported", "review", reviewId);
}

// ---------- Admin ----------
/**
 * Queue of open reports. Message bodies are private: only the *reported* message and up to 3 messages before it are
 * shown, and viewing the queue writes an audit entry naming each message exposed. There is no general inbox access.
 */
export async function openReports(actor: Actor) {
  assertCan(actor, "reports.review");
  const mrows = await db.select({ r: messageReports, m: messages, reporter: users.fullName }).from(messageReports)
    .innerJoin(messages, eq(messages.id, messageReports.messageId)).innerJoin(users, eq(users.id, messageReports.reporterId))
    .where(eq(messageReports.status, "open")).orderBy(desc(messageReports.createdAt)).limit(50);
  const out = [];
  for (const x of mrows) {
    const ctx = await db.select({ id: messages.id, senderId: messages.senderId, body: messages.body, createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.conversationId, x.m.conversationId), sql`${messages.createdAt} <= ${x.m.createdAt}`)).orderBy(desc(messages.createdAt)).limit(4);
    const [sender] = await db.select({ name: users.fullName, status: users.status }).from(users).where(eq(users.id, x.m.senderId));
    out.push({ reportId: x.r.id, reason: x.r.reason, reporter: x.reporter, senderId: x.m.senderId, senderName: sender.name, senderStatus: sender.status, context: ctx.reverse(), reportedMessageId: x.m.id });
  }
  if (out.length) await audit(actor.id, "report.message_content_accessed", "message_report", null, { messageIds: out.map((o) => o.reportedMessageId) });
  const rrows = await db.select({ r: reviewReports, rv: reviews }).from(reviewReports).innerJoin(reviews, eq(reviews.id, reviewReports.reviewId)).where(eq(reviewReports.status, "open")).orderBy(desc(reviewReports.createdAt)).limit(50);
  return { messages: out, reviews: rrows.map((x) => ({ reportId: x.r.id, reason: x.r.reason, reviewId: x.rv.id, rating: x.rv.rating, comment: x.rv.comment, hidden: x.rv.hidden })) };
}

export async function resolveMessageReport(actor: Actor, reportId: string, outcome: "actioned" | "dismissed", note: string) {
  assertCan(actor, "reports.review");
  if (note.trim().length < 5) throw new ServiceError("Add a short resolution note");
  const [r] = await db.select().from(messageReports).where(eq(messageReports.id, reportId)).limit(1);
  if (!r) throw new ServiceError("Report not found", "not_found");
  if (r.status !== "open") throw new ServiceError("This report was already resolved");
  await db.transaction(async (tx) => {
    await tx.update(messageReports).set({ status: outcome, resolutionNote: note, resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(messageReports.id, reportId));
    await audit(actor.id, `report.message_${outcome}`, "message_report", reportId, { note }, tx);
  });
  await notify(r.reporterId, "report", "Your report was reviewed", "Thanks — our team reviewed the message you reported.", "/");
}

export async function resolveReviewReport(actor: Actor, reportId: string, outcome: "hide" | "dismiss", note: string) {
  assertCan(actor, "reports.review");
  if (note.trim().length < 5) throw new ServiceError("Add a short resolution note");
  const [r] = await db.select().from(reviewReports).where(eq(reviewReports.id, reportId)).limit(1);
  if (!r) throw new ServiceError("Report not found", "not_found");
  if (r.status !== "open") throw new ServiceError("This report was already resolved");
  await db.transaction(async (tx) => {
    if (outcome === "hide") await tx.update(reviews).set({ hidden: true, hiddenReason: note }).where(eq(reviews.id, r.reviewId));
    await tx.update(reviewReports).set({ status: outcome === "hide" ? "actioned" : "dismissed", resolutionNote: note, resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(reviewReports.id, reportId));
    await audit(actor.id, `report.review_${outcome}`, "review_report", reportId, { reviewId: r.reviewId, note }, tx);
  });
}
export const _x = [inArray, conversations, assignments, businesses, businessMembers];
