import { requireUser } from "@/server/auth/session";
import { getWorkerBundle } from "@/server/services/worker";
import { AvailabilityForm, Section } from "@/components/worker-forms";
import { Button, Field, Flash, Input, PageHeader } from "@/components/ui";
import { addUnavailabilityAction, removeUnavailabilityAction } from "@/app/actions/worker";

export const metadata = { title: "My availability" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const b = await getWorkerBundle(user.id);
  return (
    <>
      <PageHeader title="My availability" subtitle="Businesses and recommendations are checked against these real days and hours." />
      <Flash error={sp.error} ok={sp.ok} />
      <Section title="Weekly availability"><AvailabilityForm b={b} /></Section>
      <Section title="How businesses see this">
        {b.profile?.availabilityPaused ? <p className="text-sm text-muted">Availability is paused — you are hidden from recommendations.</p>
          : b.availability.length === 0 ? <p className="text-sm text-muted">No hours set, so you will not match opportunities with fixed schedules.</p>
          : <ul className="text-sm">{DAYS.map((d, i) => { const w = b.availability.filter((a) => a.weekday === i); return w.length ? <li key={d}><strong>{d}</strong>: {w.map((x) => `${hm(x.startMinute)}–${hm(x.endMinute)}`).join(", ")}</li> : null; })}<li className="mt-2 text-muted">Up to {b.profile?.maxHoursPerWeek ?? "no stated maximum"} hours/week.</li></ul>}
      </Section>
      <Section title="Time off / unavailable dates">
        <form action={addUnavailabilityAction} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <Field label="From" htmlFor="s"><Input id="s" type="date" name="start" required /></Field><Field label="To" htmlFor="e"><Input id="e" type="date" name="end" required /></Field>
          <Field label="Reason (private)" htmlFor="r"><Input id="r" name="reason" maxLength={200} /></Field><Button type="submit">Add</Button>
        </form>
        <ul className="mt-4 space-y-2 text-sm">{b.unavailability.length === 0 && <li className="text-muted">No unavailable dates.</li>}
          {b.unavailability.map((u) => <li key={u.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2"><span>{u.startDate} → {u.endDate}{u.reason ? ` · ${u.reason}` : ""}</span><form action={removeUnavailabilityAction}><input type="hidden" name="id" value={u.id} /><Button variant="ghost" type="submit">Remove</Button></form></li>)}</ul>
      </Section>
    </>
  );
}
