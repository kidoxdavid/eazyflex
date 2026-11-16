import Link from "next/link";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from "./ui";
import { formatMoney } from "@/server/services/opportunities";
import { markNotificationsReadAction, reviewAction, sendMessageAction, reportMessageAction } from "@/app/actions/collab";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";

export const STATUS_TONE: Record<string, "success" | "info" | "warning" | "error" | "neutral"> = { confirmed: "info", in_progress: "info", submitted: "warning", changes_requested: "warning", completed: "success", cancelled: "error" };
export const PAYSUFFIX: Record<string, string> = { hourly: "/hour", fixed: " fixed", shift: " per shift", recurring: " per period" };

export async function NotificationList({ userId }: { userId: string }) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(100);
  if (!rows.length) return <EmptyState title="No notifications" body="Updates about applications, messages and assignments appear here." />;
  return (
    <>
      <form action={markNotificationsReadAction} className="mb-4"><Button variant="outline" type="submit">Mark all as read</Button></form>
      <ul className="space-y-2">{rows.map((n) => <li key={n.id} className={`rounded-xl border p-3 text-sm ${n.readAt ? "border-border bg-surface" : "border-primary/40 bg-secondary/40"}`}><p className="font-semibold">{n.title} {!n.readAt && <Badge tone="info">new</Badge>}</p><p className="text-muted">{n.body}</p><p className="mt-1 text-xs text-muted">{n.createdAt.toLocaleString("en-CA")}{n.href && <> · <Link className="underline" href={n.href}>Open</Link></>}</p></li>)}</ul>
    </>
  );
}

export function ConversationList({ items, base }: { items: { id: string; title: string; lastMessageAt: Date; unread: boolean }[]; base: string }) {
  if (!items.length) return <EmptyState title="No conversations yet" body="You can message once there is an application, invitation or assignment between you." />;
  return <ul className="space-y-2">{items.map((c) => <li key={c.id}><Link href={`${base}/${c.id}`} className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 hover:border-primary"><span className="font-semibold">{c.title}</span><span className="text-xs text-muted">{c.unread && <Badge tone="info">unread</Badge>} {c.lastMessageAt.toLocaleString("en-CA")}</span></Link></li>)}</ul>;
}

export function Thread({ conv, userId }: { conv: { c: { id: string }; msgs: { id: string; senderId: string; body: string; createdAt: Date }[]; businessName: string; workerName: string; me: string }; userId: string }) {
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Conversation between <strong>{conv.businessName}</strong> and <strong>{conv.workerName}</strong>. Phone numbers, emails and external chat links can be shared only once an assignment is confirmed.</p>
      <div className="space-y-2" aria-live="polite">{conv.msgs.length === 0 && <p className="text-sm text-muted">No messages yet — say hello.</p>}
        {conv.msgs.map((m) => { const mine = m.senderId === userId; return (
          <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${mine ? "ml-auto bg-primary text-white" : "bg-surface border border-border"}`}>
            <p className="whitespace-pre-wrap">{m.body}</p><p className={`mt-1 text-xs ${mine ? "text-white/70" : "text-muted"}`}>{m.createdAt.toLocaleString("en-CA")}</p>
            {!mine && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">Report</summary><form action={reportMessageAction} className="mt-1 flex gap-1"><input type="hidden" name="messageId" value={m.id} /><input type="hidden" name="conversationId" value={conv.c.id} /><Input name="reason" required minLength={5} aria-label="Reason" className="min-h-9 text-sm" /><Button variant="outline" type="submit" className="min-h-9 px-3">Send</Button></form></details>}
          </div>); })}</div>
      <form action={sendMessageAction} className="mt-4 space-y-2"><input type="hidden" name="conversationId" value={conv.c.id} /><label className="sr-only" htmlFor="body">Message</label><Textarea id="body" name="body" required maxLength={4000} rows={3} placeholder="Write a message…" /><Button type="submit">Send</Button></form>
    </div>
  );
}

export function ReviewSection({ a, userId }: { a: { a: { id: string; status: string }; reviews: { id: string; reviewerId: string; rating: number; comment: string | null; quality: number | null; communication: number | null; reliability: number | null; professionalism: number | null }[] }; userId: string }) {
  if (a.a.status !== "completed") return null;
  const mine = a.reviews.find((r) => r.reviewerId === userId);
  const theirs = a.reviews.filter((r) => r.reviewerId !== userId);
  return (
    <Card className="mt-5"><h2 className="font-sans text-lg font-semibold">Reviews</h2>
      <p className="mt-1 text-xs text-muted">Reviews are blind: you will see the other party’s review once you have both reviewed, or after 14 days.</p>
      {mine ? <p className="mt-3 text-sm">Your review: <strong>{mine.rating}/5</strong>{mine.comment ? ` — “${mine.comment}”` : ""}</p>
        : <form action={reviewAction} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="assignmentId" value={a.a.id} />
          <Field label="Overall rating" htmlFor="rating"><Select id="rating" name="rating" required defaultValue=""><option value="" disabled>Choose…</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          {["quality", "communication", "reliability", "professionalism"].map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1) + " (optional)"} htmlFor={k}><Select id={k} name={k} defaultValue=""><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>)}
          <div className="sm:col-span-2"><Field label="Comment (optional)" htmlFor="comment"><Textarea id="comment" name="comment" rows={3} maxLength={2000} /></Field></div><div><Button type="submit">Submit review</Button></div></form>}
      {theirs.map((r) => <p key={r.id} className="mt-3 rounded-xl bg-secondary/50 p-3 text-sm">Their review: <strong>{r.rating}/5</strong>{r.comment ? ` — “${r.comment}”` : ""}</p>)}
    </Card>
  );
}
export { formatMoney };
