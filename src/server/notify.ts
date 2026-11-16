import { and, eq, gt, sql } from "drizzle-orm";
import { db, type Db } from "./db/client";
import { emailOutbox, notificationPrefs, notifications, users } from "./db/schema";
import { sendEmail } from "./email";
import { brand } from "@/lib/brand";

type Tx = Pick<Db, "insert">;
export const EMAIL_CATEGORIES = ["applications", "messages", "assignments", "invitations", "reviews"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];
const CATEGORY: Record<string, EmailCategory> = {
  application_new: "applications", application_update: "applications", message: "messages", assignment: "assignments", invitation: "invitations", review: "reviews",
};
const PREF_COL = { applications: "emailApplications", messages: "emailMessages", assignments: "emailAssignments", invitations: "emailInvitations", reviews: "emailReviews" } as const;

/** In-app notification (always) + an email if the user's per-category preference allows. Emails never contain message text. */
export async function notify(userId: string, type: string, title: string, body: string, href: string, tx: Tx = db) {
  await tx.insert(notifications).values({ userId, type, title, body, href });
  const cat = CATEGORY[type];
  if (!cat) return;
  const [[u], [p]] = await Promise.all([db.select().from(users).where(eq(users.id, userId)).limit(1), db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1)]);
  if (!u || u.status !== "active" || !u.emailVerifiedAt) return; // only verified, active accounts get notification email
  if (p && p[PREF_COL[cat]] === false) return;
  if (cat === "messages") { // anti-spam: at most one message email per 15 minutes
    const [recent] = await db.select({ id: emailOutbox.id }).from(emailOutbox).where(and(eq(emailOutbox.userId, userId), eq(emailOutbox.category, "messages"), gt(emailOutbox.createdAt, sql`now() - interval '15 minutes'`))).limit(1);
    if (recent) return;
  }
  const base = `/${u.kind}/settings`;
  await sendEmail({ to: u.email, template: `notification_${type}`, subject: `${brand.name}: ${title}`, body: `${body}\n\nYou receive this because of activity on your ${brand.name} account. Manage email preferences: ${process.env.APP_URL ?? "http://localhost:3000"}${base}`, path: href, userId, category: cat });
}

export async function getPrefs(userId: string) {
  const [p] = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1);
  const d = { emailApplications: true, emailMessages: true, emailAssignments: true, emailInvitations: true, emailReviews: true };
  return p ? { ...d, ...p } : d;
}
export async function savePrefs(userId: string, v: Record<EmailCategory, boolean>) {
  const vals = { emailApplications: !!v.applications, emailMessages: !!v.messages, emailAssignments: !!v.assignments, emailInvitations: !!v.invitations, emailReviews: !!v.reviews, updatedAt: new Date() };
  await db.insert(notificationPrefs).values({ userId, ...vals }).onConflictDoUpdate({ target: notificationPrefs.userId, set: vals });
}
