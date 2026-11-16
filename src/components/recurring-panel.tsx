import { Badge, Button, Card, Field, Input } from "./ui";
import { formatMoney } from "@/server/services/opportunities";
import type { getRecurringView } from "@/server/services/recurring";
import { cancelSessionAction, confirmAllAction, confirmSessionAction, endTermAction, logSessionAction, missedAction, proposeRenewalAction, respondRenewalAction, withdrawRenewalAction } from "@/app/actions/recurring";

type V = NonNullable<Awaited<ReturnType<typeof getRecurringView>>>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayLabel = (d: string) => `${DAYS[new Date(d + "T00:00:00Z").getUTCDay()]} ${d}`;
const tone = (s: string) => (s === "completed" ? "success" : s === "missed" ? "error" : s === "cancelled" ? "outline" : "info") as "success";

export function RecurringPanel({ v, canManage }: { v: V; canManage: boolean }) {
  const a = v.assignment, w = v.side === "worker", id = a.id;
  const active = ["confirmed", "in_progress"].includes(a.status);
  const Hidden = ({ occ }: { occ?: string }) => <><input type="hidden" name="assignmentId" value={id} />{occ && <input type="hidden" name="occId" value={occ} />}</>;
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-sans text-lg font-semibold">Term</h2>
        <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Ends</dt><dd className="font-semibold">{a.endDate ?? "Open-ended"}{v.daysLeft !== null && v.daysLeft >= 0 ? ` (${v.daysLeft} days)` : v.daysLeft !== null ? " (ended)" : ""}</dd></div>
          <div><dt className="text-muted">Agreed rate</dt><dd className="font-semibold">{formatMoney(a.agreedCents)}</dd></div>
          <div><dt className="text-muted">Sessions done</dt><dd className="font-semibold">{v.totals.completed}{v.totals.missed ? ` · ${v.totals.missed} missed` : ""}{v.totals.cancelled ? ` · ${v.totals.cancelled} cancelled` : ""}</dd></div>
          <div><dt className="text-muted">Hours recorded</dt><dd className="font-semibold">{Math.round(v.totals.completedHours * 100) / 100}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted">Sessions follow the weekly schedule. Dates are calendar dates in the shared local calendar. Payment is not active in this release.</p>
      </Card>

      {v.pendingRenewal && (
        <Card className="border-primary/40 bg-secondary/30"><h2 className="font-sans text-lg font-semibold">Renewal offer <Badge tone="warning">pending</Badge></h2>
          <p className="mt-1 text-sm">Extend the term to <strong>{v.pendingRenewal.newEndDate}</strong>{v.pendingRenewal.newAgreedCents ? <> at <strong>{formatMoney(v.pendingRenewal.newAgreedCents)}</strong> (currently {formatMoney(a.agreedCents)})</> : <> at the same rate</>}.{v.pendingRenewal.note ? ` “${v.pendingRenewal.note}”` : ""}</p>
          {w ? <form action={respondRenewalAction} className="mt-3 flex gap-2"><Hidden /><input type="hidden" name="offerId" value={v.pendingRenewal.id} /><Button name="decision" value="accept" type="submit">Accept renewal</Button><Button name="decision" value="decline" variant="outline" type="submit">Decline</Button></form>
            : canManage && <form action={withdrawRenewalAction} className="mt-3"><Hidden /><input type="hidden" name="offerId" value={v.pendingRenewal.id} /><Button variant="outline" type="submit">Withdraw offer</Button></form>}
          {w && <p className="mt-2 text-xs text-muted">You decide: nothing changes unless you accept, including any change of rate.</p>}</Card>)}

      {!w && canManage && active && !v.pendingRenewal && a.endDate && (
        <Card><h2 className="font-sans text-lg font-semibold">Propose a renewal</h2>
          {v.preferSameWorker && <p className="mt-1 text-sm text-muted">You said you’d like to renew with the same worker where possible.</p>}
          <form action={proposeRenewalAction} className="mt-3 grid items-end gap-3 sm:grid-cols-4"><Hidden />
            <Field label="New end date" htmlFor="ned"><Input id="ned" type="date" name="newEndDate" required min={a.endDate} /></Field>
            <Field label="New rate (optional)" htmlFor="nr" hint="Leave blank to keep the same."><Input id="nr" type="number" step="0.01" min="0.01" name="newRate" /></Field>
            <div className="sm:col-span-2"><Field label="Note (optional)" htmlFor="nn"><Input id="nn" name="note" maxLength={1000} /></Field></div><div><Button type="submit">Offer renewal</Button></div></form></Card>)}

      <section><h2 className="mb-2 text-xl font-semibold">Upcoming sessions</h2>
        {v.upcoming.length === 0 ? <p className="text-sm text-muted">No upcoming sessions.</p> : <ul className="space-y-2">{v.upcoming.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm"><span><strong>{dayLabel(o.occursOn)}</strong> {hm(o.startMinute)}–{hm(o.endMinute)} <Badge tone={tone(o.status)}>{o.status}</Badge>{o.cancelReason ? <span className="text-muted"> — {o.cancelReason}</span> : null}</span>
            {o.status === "scheduled" && active && (w || canManage) && <details><summary className="cursor-pointer underline">{w ? "Can’t make it" : "Cancel"}</summary><form action={cancelSessionAction} className="mt-1 flex gap-1"><Hidden occ={o.id} /><Input name="reason" required minLength={5} aria-label="Reason" className="min-h-9" /><Button variant="outline" type="submit" className="min-h-9 px-3">Cancel session</Button></form></details>}</li>))}</ul>}</section>

      <section><h2 className="mb-2 text-xl font-semibold">Past sessions</h2>
        {v.past.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <ul className="space-y-2">{[...v.past].reverse().map((o) => (
          <li key={o.id} className="rounded-xl border border-border bg-surface p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{dayLabel(o.occursOn)}</strong> {hm(o.startMinute)}–{hm(o.endMinute)} <Badge tone={tone(o.status)}>{o.status}</Badge>{o.status === "completed" && (o.confirmedAt ? <> <Badge tone="success">confirmed</Badge></> : <> <Badge tone="warning">awaiting confirmation</Badge></>)}{o.hours ? ` · ${Number(o.hours)} h` : ""}</span>
            {!w && canManage && active && o.status === "completed" && !o.confirmedAt && <form action={confirmSessionAction}><Hidden occ={o.id} /><Button variant="outline" type="submit" className="min-h-9 px-3">Confirm</Button></form>}</div>
            {o.workerNote && <p className="mt-1 text-muted">“{o.workerNote}”</p>}{o.cancelReason && <p className="mt-1 text-muted">{o.cancelReason}</p>}
            {w && active && o.status === "scheduled" && <form action={logSessionAction} className="mt-2 flex flex-wrap items-end gap-2"><Hidden occ={o.id} /><Field label="Hours worked" htmlFor={`h${o.id}`}><Input id={`h${o.id}`} name="hours" type="number" step="0.25" min="0.25" max="24" required={a.payType === "hourly"} className="w-28" /></Field><Field label="Note (optional)" htmlFor={`n${o.id}`}><Input id={`n${o.id}`} name="note" maxLength={1000} /></Field><Button type="submit">Record session</Button></form>}
            {!w && canManage && active && o.status === "scheduled" && <details className="mt-1"><summary className="cursor-pointer text-xs underline">Mark missed</summary><form action={missedAction} className="mt-1 flex gap-1"><Hidden occ={o.id} /><Input name="note" required minLength={5} aria-label="What happened" className="min-h-9" /><Button variant="outline" type="submit" className="min-h-9 px-3">Mark missed</Button></form></details>}</li>))}</ul>}</section>

      {!w && canManage && active && (
        <Card><h2 className="font-sans text-lg font-semibold">Close out</h2>
          <p className="mt-1 text-sm text-muted">Ending the term completes the assignment, cancels any remaining sessions and opens reviews. {v.blockers.canEnd ? "Everything in the past is resolved and confirmed." : `Before you can end it: ${v.blockers.unresolved} past session(s) need recording or marking missed, and ${v.blockers.unconfirmed} recorded session(s) need your confirmation.`}</p>
          <div className="mt-3 flex flex-wrap gap-2"><form action={confirmAllAction}><Hidden /><Button variant="outline" type="submit">Confirm all recorded sessions</Button></form><form action={endTermAction}><Hidden /><Button variant="secondary" type="submit" disabled={!v.blockers.canEnd}>End term</Button></form></div></Card>)}

      {v.renewals.filter((r) => r.status !== "pending").length > 0 && <section><h2 className="mb-2 text-xl font-semibold">Renewal history</h2><ul className="space-y-1 text-sm text-muted">{v.renewals.filter((r) => r.status !== "pending").map((r) => <li key={r.id}>{r.createdAt.toLocaleDateString("en-CA")} — to {r.newEndDate}{r.newAgreedCents ? ` at ${formatMoney(r.newAgreedCents)}` : ""}: <strong>{r.status}</strong></li>)}</ul></section>}
    </div>
  );
}

