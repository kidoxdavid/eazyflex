import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailOutbox } from "@/server/db/schema";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };
// Development only: shows emails recorded by the "outbox" email driver. Disabled in production.
export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const rows = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(30);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Dev email outbox</h1>
      <p className="mt-1 text-sm text-muted">Nothing here has been delivered; the outbox driver only records messages.</p>
      <ul className="mt-4 space-y-3">{rows.map((r) => <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm"><p className="font-semibold">{r.subject} → {r.toEmail}</p><p className="text-muted">{r.body}</p>{r.link && <a className="break-all underline" href={r.link}>{r.link}</a>}</li>)}</ul>
    </div>
  );
}
