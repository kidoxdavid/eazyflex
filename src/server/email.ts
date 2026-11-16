import { db } from "./db/client";
import { emailOutbox } from "./db/schema";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/**
 * Email provider abstraction. The only driver implemented is "outbox" (records the message in
 * email_outbox; nothing is delivered). A production driver (transactional provider) must be added
 * before launch — see DEPLOYMENT_GUIDE.md. Messages are never reported as "sent" by this driver.
 */
export async function sendEmail(m: { to: string; template: string; subject: string; body: string; path?: string }) {
  const driver = process.env.EMAIL_DRIVER ?? "outbox";
  if (driver !== "outbox") throw new Error(`Email driver "${driver}" is not implemented`);
  await db.insert(emailOutbox).values({
    toEmail: m.to, template: m.template, subject: m.subject, body: m.body,
    link: m.path ? appUrl() + m.path : null, status: "queued",
  });
}
