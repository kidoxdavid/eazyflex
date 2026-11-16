import Link from "next/link";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Textarea } from "./ui";
import { PAYSUFFIX, ReviewSection, STATUS_TONE, formatMoney } from "./collab";
import { businessAssignmentAction, openConversationAction, workerAssignmentAction } from "@/app/actions/collab";
import type { getAssignment } from "@/server/services/assignments";

type D = Awaited<ReturnType<typeof getAssignment>>;
const Act = ({ id, action, children, variant = "outline", fields }: { id: string; action: string; children: React.ReactNode; variant?: "primary" | "outline" | "danger"; fields?: React.ReactNode }) => null;

export function AssignmentView({ d, userId, sp }: { d: D; userId: string; sp: { ok?: string; error?: string } }) {
  const a = d.a, w = d.side === "worker";
  const act = w ? workerAssignmentAction : businessAssignmentAction;
  return (
    <>
      <PageHeader title={d.title} subtitle={`${w ? d.businessName : d.workerName} · ${formatMoney(a.agreedCents)}${PAYSUFFIX[a.payType]} agreed`} action={<Badge tone={STATUS_TONE[a.status]}>{a.status.replace(/_/g, " ")}</Badge>} />
      <Flash error={sp.error} ok={sp.ok} />
      <Card className="mb-5 text-sm"><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-muted">Dates</dt><dd className="font-semibold">{a.startDate ?? "Flexible"} → {a.endDate ?? "—"}</dd></div><div><dt className="text-muted">Pay basis</dt><dd className="font-semibold">{a.payType}</dd></div><div><dt className="text-muted">Payment</dt><dd className="font-semibold">Not active in this release</dd></div></dl>
        <form action={openConversationAction} className="mt-3"><input type="hidden" name="counterpartId" value={w ? a.businessId : a.workerId} /><input type="hidden" name="opportunityId" value={a.opportunityId} /><input type="hidden" name="back" value={`/${d.side}/assignments/${a.id}`} /><Button variant="outline" type="submit">Message {w ? "business" : "worker"}</Button></form></Card>

      <div className="mb-5 flex flex-wrap gap-3">
        {w && a.status === "confirmed" && <form action={act}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="start" /><Button type="submit">Start work</Button></form>}
        {!w && a.status === "submitted" && <form action={act}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="approve" /><Button type="submit">Approve completion</Button></form>}
      </div>

      {w && ["confirmed", "in_progress", "changes_requested"].includes(a.status) && (
        <Card className="mb-5"><h2 className="font-sans text-lg font-semibold">Submit work</h2>
          <form action={act} className="mt-3 space-y-3"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="submit" />
            <Field label="What are you submitting?" htmlFor="note"><Textarea id="note" name="note" required minLength={10} /></Field>
            {a.payType === "hourly" && <Field label="Hours worked (required for hourly work)" htmlFor="h"><Input id="h" name="hoursWorked" type="number" step="0.25" min="0.25" required /></Field>}
            <Field label="Link to deliverable (optional)" htmlFor="l" hint="File uploads aren’t available yet — share a link."><Input id="l" name="link" type="url" /></Field>
            <Button type="submit">Submit for approval</Button></form></Card>
      )}
      {!w && a.status === "submitted" && (
        <Card className="mb-5"><h2 className="font-sans text-lg font-semibold">Request changes</h2>
          <form action={act} className="mt-3 space-y-3"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="request_changes" /><Field label="What needs to change?" htmlFor="n"><Textarea id="n" name="note" required minLength={5} rows={3} /></Field><Button variant="outline" type="submit">Request changes</Button></form></Card>
      )}

      <h2 className="mb-2 text-xl font-semibold">Submissions</h2>
      {d.submissions.length === 0 ? <p className="text-sm text-muted">Nothing submitted yet.</p> : <div className="space-y-3">{d.submissions.map((s) => <Card key={s.id} className="text-sm"><p className="whitespace-pre-line">{s.note}</p>{s.hoursWorked && <p className="mt-1 text-muted">Hours: {Number(s.hoursWorked)}</p>}{s.link && <p className="mt-1"><a className="break-all underline" href={s.link} rel="noopener noreferrer nofollow" target="_blank">{s.link}</a></p>}<p className="mt-1 text-xs text-muted">{s.createdAt.toLocaleString("en-CA")} · {s.outcome ? s.outcome.replace("_", " ") : "awaiting review"}{s.reviewerNote ? ` — “${s.reviewerNote}”` : ""}</p></Card>)}</div>}

      <ReviewSection a={d} userId={userId} />

      {["confirmed", "in_progress", "changes_requested", ...(w ? [] : ["submitted"])].includes(a.status) && (
        <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-error">Cancel this assignment</summary>
          <form action={act} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="cancel" /><Field label="Reason (shared with the other party)" htmlFor="r"><Input id="r" name={w ? "reason" : "note"} required minLength={5} /></Field><Button variant="danger" type="submit">Cancel assignment</Button></form></details>)}
      <h2 className="mb-2 mt-8 text-xl font-semibold">History</h2>
      <ol className="space-y-1 text-sm text-muted">{d.history.length === 0 ? <li>Confirmed {a.createdAt.toLocaleString("en-CA")}</li> : d.history.map((h) => <li key={h.id}>{h.createdAt.toLocaleString("en-CA")} — {h.toStatus.replace(/_/g, " ")}{h.note ? ` (${h.note})` : ""}</li>)}</ol>
    </>
  );
}
export const _l = Link; export const _a = Act;
