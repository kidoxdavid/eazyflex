import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { fmtWin, getCoverageView, listCandidates, suggest } from "@/server/services/coverage";
import { CoverageGrid, colourFor } from "@/components/coverage-grid";
import { addHandoverAction, manualSliceAction, proposeCoverageAction, releaseSliceAction } from "@/app/actions/coverage";
import { Badge, Button, Card, EmptyState, Field, Flash, Input, LinkButton, PageHeader, Select, Stat, Textarea } from "@/components/ui";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hrs = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; suggest?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  if (!uuid.test(id)) notFound();
  const u = await requireUser("business");
  const v = await getCoverageView(u.id, id).catch(() => null);
  if (!v) notFound();
  const o = v.opportunity;
  if (v.required.length === 0) return <><PageHeader title="Shared coverage" /><EmptyState title="No scheduled hours" body="Shared coverage needs scheduled days and hours. Edit the opportunity and add a schedule (recurring work or a flexible shift)." action={<LinkButton href={`/business/opportunities/${id}`}>Back to opportunity</LinkButton>} /></>;
  const [cands, sug] = await Promise.all([listCandidates(u.id, id), sp.suggest ? suggest(u.id, id).catch(() => null) : Promise.resolve(null)]);
  const ids = [...new Set(v.slices.filter((s) => ["proposed", "confirmed"].includes(s.status)).map((s) => s.workerId))];
  const r = v.report; const live = o.status === "published";
  const nameOf = new Map(v.slices.map((s) => [s.workerId, s.workerName]));
  return (
    <>
      <Link href={`/business/opportunities/${id}`} className="on-dark text-sm font-semibold text-white underline">← {o.title}</Link>
      <PageHeader title="Shared coverage" subtitle="Split the required hours between several people. Nobody is booked until they confirm their own slice." />
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4"><Stat label="Required per week" value={hrs(r.requiredMinutes)} /><Stat label="Confirmed" value={`${r.percentConfirmed}%`} hint={hrs(r.confirmedMinutes)} /><Stat label="Planned (incl. proposed)" value={hrs(r.plannedMinutes)} /><Stat label="Uncovered" value={hrs(r.requiredMinutes - r.plannedMinutes)} hint={r.complete ? "Fully confirmed" : undefined} /></div>
      {r.complete && <p className="mt-4 rounded-xl bg-[#dff3e8] p-3 text-sm font-semibold text-success">Every required hour is confirmed.</p>}
      {r.overlaps.length > 0 && <p role="alert" className="mt-4 rounded-xl bg-[#fbe3e1] p-3 text-sm text-error">Overlapping slices: {r.overlaps.map((x) => `${fmtWin(x)} (${x.workerIds.map((w) => nameOf.get(w)).join(" & ")})`).join("; ")}</p>}
      <Card className="mt-5"><CoverageGrid required={v.required} gaps={r.plannedGaps} overlaps={r.overlaps} slices={v.slices} /></Card>

      <h2 className="mb-2 mt-8 text-xl font-semibold">Who covers what</h2>
      {v.slices.filter((s) => ["proposed", "confirmed"].includes(s.status)).length === 0 ? <p className="text-sm text-muted">No slices yet.</p> :
        <div className="overflow-x-auto rounded-xl border border-border bg-surface" tabIndex={0} role="region" aria-label="Coverage slices table (scrollable)"><table className="w-full text-left text-sm"><caption className="sr-only">Slices</caption><thead className="bg-secondary/50"><tr><th className="p-2">Worker</th><th className="p-2">Slot</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead><tbody>
          {v.slices.filter((s) => ["proposed", "confirmed"].includes(s.status)).map((s) => <tr key={s.id} className="border-t border-border"><td className="p-2"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: colourFor(ids, s.workerId) }} aria-hidden />{s.workerName}</td><td className="p-2">{fmtWin(s)}</td>
            <td className="p-2"><Badge tone={s.status === "confirmed" ? "success" : "warning"}>{s.status}</Badge>{s.agreedOutside && <> <Badge tone="info">worker agreed to out-of-availability</Badge></>}{s.status === "proposed" && s.outsideAvailability && <> <Badge tone="warning">outside stated availability</Badge></>}</td>
            <td className="p-2"><details><summary className="cursor-pointer text-xs underline">Release</summary><form action={releaseSliceAction} className="mt-1 flex gap-1"><input type="hidden" name="sliceId" value={s.id} /><input type="hidden" name="back" value={`/business/opportunities/${id}/coverage`} /><Input name="reason" required minLength={5} aria-label="Reason" className="min-h-9" /><Button variant="outline" type="submit" className="min-h-9 px-3">Release</Button></form></details></td></tr>)}</tbody></table></div>}

      {live && <>
        <h2 className="mb-2 mt-8 text-xl font-semibold">Find coverage</h2>
        <Card>
          <p className="text-sm text-muted">We look for available, discoverable workers who meet your required skills and propose slices only <strong>inside</strong> their stated availability, weekly maximum and existing commitments.</p>
          <div className="mt-3"><LinkButton href={`/business/opportunities/${id}/coverage?suggest=1`} variant="secondary">Suggest coverage for the open hours</LinkButton></div>
          {sp.suggest && (sug === null ? <p className="mt-3 text-sm text-error">Couldn’t compute suggestions.</p> : <div className="mt-4">
            <p className="text-sm"><strong>{sug.candidateCount}</strong> eligible worker{sug.candidateCount === 1 ? "" : "s"} considered.</p>
            {sug.suggestions.length === 0 ? <p className="mt-2 text-sm text-muted">No further coverage can be suggested with current availability.</p> : <>
              <ul className="mt-2 space-y-2 text-sm">{sug.suggestions.map((s, i) => <li key={i} className="rounded-xl border border-border p-3"><strong>{s.workerName}</strong> — {fmtWin(s)} <Badge tone="info">match {s.score}/100</Badge><p className="mt-1 text-xs text-muted">{s.explanation}</p></li>)}</ul>
              <form action={proposeCoverageAction} className="mt-3"><input type="hidden" name="opportunityId" value={id} /><input type="hidden" name="slices" value={JSON.stringify(sug.suggestions.map(({ workerId, weekday, startMinute, endMinute }) => ({ workerId, weekday, startMinute, endMinute })))} /><Button type="submit">Propose these {sug.suggestions.length} slices</Button><p className="mt-1 text-xs text-muted">Each worker is asked to confirm or decline. You are not hiring anyone automatically.</p></form></>}
            {sug.remainingGaps.length > 0 && <p className="mt-3 rounded-xl bg-[#fbebd3] p-3 text-sm text-warning">Still uncovered after these: {sug.remainingGaps.map(fmtWin).join(", ")}</p>}
          </div>)}
        </Card>
        <h3 className="mb-2 mt-6 font-sans text-lg font-semibold">Propose a slice yourself</h3>
        <Card><form action={manualSliceAction} className="grid items-end gap-3 sm:grid-cols-5"><input type="hidden" name="opportunityId" value={id} />
          <Field label="Worker" htmlFor="wk"><Select id="wk" name="workerId" required defaultValue=""><option value="" disabled>Choose…</option>{cands.map((c) => <option key={c.workerId} value={c.workerId}>{c.name} ({c.score})</option>)}</Select></Field>
          <Field label="Day" htmlFor="dy"><Select id="dy" name="weekday" defaultValue="1">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <Field label="From" htmlFor="st"><Input id="st" type="time" name="start" required /></Field><Field label="To" htmlFor="en"><Input id="en" type="time" name="end" required /></Field><Button type="submit">Propose</Button></form>
          <p className="mt-2 text-xs text-muted">A slice outside the worker’s stated availability is flagged, and they must explicitly agree to it.</p></Card>
      </>}

      <h2 className="mb-2 mt-8 text-xl font-semibold">Handovers</h2>
      {v.handovers.length === 0 ? <p className="text-sm text-muted">Handovers appear where one confirmed worker’s slice ends exactly when another’s begins.</p> :
        <div className="space-y-3">{v.handovers.map((h) => <Card key={h.from.id + h.to.id}><p className="text-sm"><strong>{nameOf.get(h.from.workerId)}</strong> → <strong>{nameOf.get(h.to.workerId)}</strong> · {DAYS[h.to.weekday]} at {fmtWin({ ...h.to, endMinute: h.to.startMinute }).split(" ")[1].split("–")[0]}</p>
          {h.note ? <p className="mt-2 rounded-xl bg-secondary/40 p-3 text-sm">{h.note.note}<span className="mt-1 block text-xs text-muted">{h.note.acknowledgedAt ? "✓ Acknowledged by the incoming worker" : "Not yet acknowledged"}</span></p>
            : <form action={addHandoverAction} className="mt-2 space-y-2"><input type="hidden" name="fromSliceId" value={h.from.id} /><input type="hidden" name="toSliceId" value={h.to.id} /><input type="hidden" name="back" value={`/business/opportunities/${id}/coverage`} /><Field label="Handover note (optional for you — the outgoing worker can also write it)" htmlFor={`h${h.from.id}`}><Textarea id={`h${h.from.id}`} name="note" rows={2} required minLength={5} /></Field><Button variant="outline" type="submit">Save note</Button></form>}</Card>)}</div>}
    </>
  );
}
