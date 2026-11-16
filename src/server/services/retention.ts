import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { authTokens, emailOutbox, notifications, rateLimits, sessions } from "../db/schema";
import { log } from "../monitoring";

/**
 * Retention periods (documented in RUNBOOK.md). Anything not listed is kept until its owner deletes it or the account is erased.
 * Audit logs are NOT purged here: they are append-only and hold only opaque ids.
 */
export const RETENTION = {
  expiredSessionsDays: 0,        // sessions past their expiry
  usedOrExpiredTokensDays: 7,    // email-verification / password-reset tokens, after use or expiry
  rateLimitRowsDays: 1,
  deliveredEmailDays: 90,        // sent / failed / skipped outbox rows
  stuckQueuedEmailDays: 30,      // queued but never delivered (e.g. EMAIL_DRIVER=outbox)
  readNotificationDays: 180,
  unreadNotificationDays: 365,
} as const;

const ago = (days: number, now: Date) => new Date(now.getTime() - days * 86400_000);

export async function runRetention(now = new Date()) {
  const out: Record<string, number> = {};
  out.sessions = (await db.delete(sessions).where(lt(sessions.expiresAt, ago(RETENTION.expiredSessionsDays, now))).returning({ id: sessions.id })).length;
  const tokCut = ago(RETENTION.usedOrExpiredTokensDays, now);
  out.authTokens = (await db.delete(authTokens).where(sql`(${authTokens.usedAt} is not null and ${authTokens.usedAt} < ${tokCut.toISOString()}::timestamptz) or ${authTokens.expiresAt} < ${tokCut.toISOString()}::timestamptz`).returning({ id: authTokens.id })).length;
  out.rateLimits = (await db.delete(rateLimits).where(lt(rateLimits.windowStart, ago(RETENTION.rateLimitRowsDays, now))).returning({ k: rateLimits.key })).length;
  out.emailDelivered = (await db.delete(emailOutbox).where(and(inArray(emailOutbox.status, ["sent", "failed", "skipped"]), lt(emailOutbox.createdAt, ago(RETENTION.deliveredEmailDays, now)))).returning({ id: emailOutbox.id })).length;
  out.emailStuck = (await db.delete(emailOutbox).where(and(eq(emailOutbox.status, "queued"), lt(emailOutbox.createdAt, ago(RETENTION.stuckQueuedEmailDays, now)))).returning({ id: emailOutbox.id })).length;
  out.notificationsRead = (await db.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, ago(RETENTION.readNotificationDays, now)))).returning({ id: notifications.id })).length;
  out.notificationsUnread = (await db.delete(notifications).where(lt(notifications.createdAt, ago(RETENTION.unreadNotificationDays, now))).returning({ id: notifications.id })).length;
  log.info("retention run complete", out);
  return out;
}
