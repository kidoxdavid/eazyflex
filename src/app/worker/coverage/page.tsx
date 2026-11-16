import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { fmtWin, listWorkerCoverage } from "@/server/services/coverage";
import { ackHandoverAction, addHandoverAction, releaseSliceAction, respondSliceAction } from "@/app/actions/coverage";
import { Badge, Button, Card, EmptyState, Field, Flash, Input, PageHeader, Textarea } from "@/components/ui";

export const metadata = { title: "Shift coverage" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("worker");
  const { items, handovers, totalConfirmedMinutes } = await listWorkerCoverage(u.id);
  const proposed = items.filter((i) => i.s.status === "proposed"), confirmed = items.filter((i) => i.s.status === "confirmed");
  return (
    <>
      <PageHeader title="Shift coverage" subtitle="Businesses sharing a requirement between several people may ask you to cover part of it. Nothing is booked until you confirm." />
      <Flash error={sp.error} ok={sp.ok} />
      <h2 className="mb-3 text-xl font-semibold">Requests to confirm ({proposed.length})</h2>
      {proposed.length === 0 ? <p className="text-sm text-muted">No pending requests.</p> : <div className="space-y-3">{proposed.map((i) => (
        <Card key={i.s.id}><p className="font-semibold"><Link className="hover:underline" href={`/opportunities/${i.oppId}`}>{i.title}</Link> <span className="font-normal text-muted">· {i.businessName}</span></p>
          <p className="mt-1 text-lg">{fmtWin(i.s)} <span className="text-sm text-muted">every week</span></p>
          {i.outside && <p className="mt-2 rounded-xl bg-[#fbebd3] p-2 text-sm text-warning">This is outside the availability you set.</p>}
          {i.overCap && <p className="mt-2 rounded-xl bg-[#fbebd3] p-2 text-sm text-warning">Confirming would take you over your weekly maximum.</p>}
          {i.clash && <p className="mt-2 rounded-xl bg-[#fbe3e1] p-2 text-sm text-error">You already have a confirmed slice at {i.clash} that overlaps. You can only decline this one.</p>}
          <form action={respondSliceAction} className="mt-3 space-y-2"><input type="hidden" name="sliceId" value={i.s.id} />
            {(i.outside || i.overCap) && !i.clash && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acknowledge" className="mt-0.5 size-5" /> I understand and agree to work this slice even though {i.outside ? "it’s outside my stated availability" : "it exceeds my weekly maximum"}.</label>}
            <div className="flex gap-2">{!i.clash && <Button name="decision" value="confirm" type="submit">Confirm</Button>}<Button name="decision" value="decline" variant="outline" type="submit">Decline</Button></div></form></Card>))}</div>}

      <h2 className="mb-1 mt-8 text-xl font-semibold">My confirmed slices</h2>
      <p className="mb-3 text-sm text-muted">{Math.round((totalConfirmedMinutes / 60) * 10) / 10} h per week confirmed.</p>
      {confirmed.length === 0 ? <EmptyState title="Nothing confirmed" body="Confirmed slices appear here and count against your availability." /> : <div className="space-y-2">{confirmed.map((i) => (
        <Card key={i.s.id} className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{fmtWin(i.s)} <Badge tone="success">confirmed</Badge></p><p className="text-sm text-muted">{i.title} · {i.businessName}{i.s.agreedOutside ? " · you agreed to this outside your stated availability" : ""}</p></div>
          <details><summary className="cursor-pointer text-sm underline">Give this slice back</summary><form action={releaseSliceAction} className="mt-2 flex gap-2"><input type="hidden" name="sliceId" value={i.s.id} /><input type="hidden" name="back" value="/worker/coverage" /><Input name="reason" required minLength={5} aria-label="Reason" placeholder="Reason (shared with the business)" /><Button variant="outline" type="submit">Release</Button></form></details></Card>))}</div>}

      <h2 className="mb-3 mt-8 text-xl font-semibold">Handovers</h2>
      {handovers.length === 0 ? <p className="text-sm text-muted">None — handovers appear when your slice is directly before or after a colleague’s.</p> : <div className="space-y-3">{handovers.map((h) => (
        <Card key={h.from.id + h.to.id}><p className="text-sm font-semibold">{h.direction === "outgoing" ? `You hand over at ${fmtWin({ ...h.from, startMinute: h.from.endMinute }).split(" ")[1].split("–")[0]}` : "You take over"} · {fmtWin(h.direction === "outgoing" ? h.from : h.to)}</p>
          {h.note ? <><p className="mt-2 whitespace-pre-line rounded-xl bg-secondary/40 p-3 text-sm">{h.note.note}</p>{h.direction === "incoming" && !h.note.acknowledgedAt && <form action={ackHandoverAction} className="mt-2"><input type="hidden" name="noteId" value={h.note.id} /><Button variant="outline" type="submit">Acknowledge</Button></form>}{h.note.acknowledgedAt && <p className="mt-1 text-xs text-muted">✓ Acknowledged</p>}</>
            : h.direction === "outgoing" ? <form action={addHandoverAction} className="mt-2 space-y-2"><input type="hidden" name="fromSliceId" value={h.from.id} /><input type="hidden" name="toSliceId" value={h.to.id} /><input type="hidden" name="back" value="/worker/coverage" /><Field label="What should the next person know?" htmlFor={`n${h.from.id}`}><Textarea id={`n${h.from.id}`} name="note" rows={3} required minLength={5} /></Field><Button type="submit">Leave handover note</Button></form> : <p className="mt-2 text-sm text-muted">Waiting for the outgoing worker’s note.</p>}</Card>))}</div>}
    </>
  );
}
