import { requireAdmin, requireUser } from "@/server/auth/session";
import { openReports } from "@/server/services/moderation";
import type { Actor } from "@/server/services/admin";
import { Badge, Button, Card, Flash, Input, PageHeader } from "@/components/ui";
import { resolveReportAction, userStatusAction } from "@/app/actions/admin";

export const metadata = { title: "Reports" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin("reports.review");
  const u = await requireUser("admin");
  const r = await openReports({ id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] });
  return (
    <>
      <PageHeader title="Reports" subtitle="Only the reported message and a little context are shown. Viewing this page is audit-logged." />
      <Flash error={sp.error} ok={sp.ok} />
      <h2 className="mb-3 text-xl font-semibold">Reported messages ({r.messages.length})</h2>
      <div className="space-y-4">{r.messages.length === 0 && <p className="text-sm text-muted">None open.</p>}{r.messages.map((m) => (
        <Card key={m.reportId}><p className="text-sm"><strong>Reason:</strong> {m.reason} <span className="text-muted">(reported by {m.reporter})</span></p>
          <div className="mt-2 space-y-1 rounded-xl bg-secondary/40 p-3 text-sm">{m.context.map((c) => <p key={c.id} className={c.id === m.reportedMessageId ? "font-semibold" : "text-muted"}>{c.id === m.reportedMessageId ? "▶ " : ""}{c.senderId === m.senderId ? m.senderName : "Other party"}: {c.body}</p>)}</div>
          <form action={resolveReportAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="kind" value="message" /><input type="hidden" name="id" value={m.reportId} /><label className="text-sm font-semibold">Resolution note<Input name="note" required minLength={5} className="mt-1 w-72 font-normal" /></label><Button name="outcome" value="actioned" type="submit">Mark actioned</Button><Button name="outcome" value="dismissed" variant="outline" type="submit">Dismiss</Button></form>
          <form action={userStatusAction} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="userId" value={m.senderId} /><input type="hidden" name="status" value="suspended" /><label className="text-sm">Suspend sender ({m.senderStatus}) — reason<Input name="reason" required className="mt-1 w-72" /></label><Button variant="danger" type="submit">Suspend sender</Button></form></Card>))}</div>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Reported reviews ({r.reviews.length})</h2>
      <div className="space-y-4">{r.reviews.length === 0 && <p className="text-sm text-muted">None open.</p>}{r.reviews.map((v) => (
        <Card key={v.reportId}><p className="text-sm"><Badge>{v.rating}/5</Badge> “{v.comment ?? "(no comment)"}”</p><p className="mt-1 text-sm"><strong>Reason:</strong> {v.reason}</p>
          <form action={resolveReportAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="kind" value="review" /><input type="hidden" name="id" value={v.reportId} /><label className="text-sm font-semibold">Resolution note<Input name="note" required minLength={5} className="mt-1 w-72 font-normal" /></label><Button name="outcome" value="hide" variant="danger" type="submit">Hide review</Button><Button name="outcome" value="dismiss" variant="outline" type="submit">Dismiss</Button></form></Card>))}</div>
    </>
  );
}
