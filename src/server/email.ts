import nodemailer from "nodemailer";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db/client";
import { emailOutbox } from "./db/schema";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/** Queue an email. Delivery is done by processOutbox() (run by `npm run emails:send` on a schedule). */
export async function sendEmail(m: { to: string; template: string; subject: string; body: string; path?: string; userId?: string; category?: string }) {
  await db.insert(emailOutbox).values({
    toEmail: m.to, template: m.template, subject: m.subject, body: m.body, link: m.path ? appUrl() + m.path : null,
    status: "queued", userId: m.userId ?? null, category: m.category ?? null,
  });
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
const getTransport = () => (transport ??= nodemailer.createTransport(process.env.SMTP_URL!));

/**
 * Delivers queued emails. EMAIL_DRIVER=outbox (default) delivers nothing and leaves rows queued — nothing is ever marked
 * "sent" unless the SMTP server accepted the message. EMAIL_DRIVER=smtp uses SMTP_URL (e.g. smtps://user:pass@host:465).
 */
export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if ((process.env.EMAIL_DRIVER ?? "outbox") !== "smtp") return { sent: 0, failed: 0, skipped: true };
  if (!process.env.SMTP_URL || !process.env.EMAIL_FROM) throw new Error("SMTP_URL and EMAIL_FROM are required when EMAIL_DRIVER=smtp");
  const rows = await db.select().from(emailOutbox).where(and(eq(emailOutbox.status, "queued"), lt(emailOutbox.attempts, 5))).orderBy(emailOutbox.createdAt).limit(limit);
  let sent = 0, failed = 0;
  for (const r of rows) {
    // Claim the row so two dispatchers cannot send the same message.
    const claimed = await db.update(emailOutbox).set({ attempts: sql`${emailOutbox.attempts} + 1` }).where(and(eq(emailOutbox.id, r.id), eq(emailOutbox.status, "queued"), eq(emailOutbox.attempts, r.attempts))).returning({ id: emailOutbox.id });
    if (!claimed.length) continue;
    try {
      const text = `${r.body}${r.link ? `\n\n${r.link}` : ""}`;
      await getTransport().sendMail({ from: process.env.EMAIL_FROM, to: r.toEmail, subject: r.subject, text });
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(emailOutbox.id, r.id)); sent++;
    } catch (e: any) {
      const final = r.attempts + 1 >= 5;
      await db.update(emailOutbox).set({ status: final ? "failed" : "queued", error: String(e?.message ?? e).slice(0, 300) }).where(eq(emailOutbox.id, r.id)); failed++;
    }
  }
  return { sent, failed, skipped: false };
}
