import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { getBusinessForUser } from "@/server/services/business";
import { getAreas, getCategories, getSkills } from "@/server/services/catalog";
import { ENGAGEMENT_LABELS, getOpportunityDetail } from "@/server/services/opportunities";
import { Button, Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { saveOpportunityAction } from "@/app/actions/business";

export const metadata = { title: "Post work" };
const TYPES: [string, string, string][] = [
  ["micro_task", "Short task", "A few hours of help, roughly one to five."], ["fixed_project", "Project (set fee)", "Clear deliverables, a deadline and a fee."],
  ["flexible_shift", "Shift", "A scheduled period of agreed duties."], ["recurring", "Ongoing work", "Work that repeats weekly or monthly."],
  ["specialist_consultation", "Expert advice", "Help from someone with specific experience."], ["local_service", "Local job", "Something that needs someone on site."],
];
const PAY_OPTS: Record<string, [string, string][]> = {
  micro_task: [["hourly", "Hourly rate"], ["fixed", "Fixed fee"]], fixed_project: [["fixed", "Fixed project fee (or budget range)"]], flexible_shift: [["shift", "Pay per shift"], ["hourly", "Hourly rate"]],
  recurring: [["recurring", "Recurring pay per period"], ["hourly", "Hourly rate"]], specialist_consultation: [["hourly", "Hourly rate"], ["fixed", "Fixed fee"]], local_service: [["fixed", "Fixed fee"], ["hourly", "Hourly rate"], ["shift", "Pay per shift"]],
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const t = (m?: number) => (m === undefined ? "" : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; id?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("business");
  const m = (await getBusinessForUser(user.id))!;
  const existing = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? await getOpportunityDetail(sp.id) : null;
  const mine = existing && existing.o.businessId === m.b.id ? existing : null; // never prefill another business's data
  const type = mine?.o.engagementType ?? (sp.type && sp.type in ENGAGEMENT_LABELS ? sp.type : null);

  if (!type) return (
    <>
      <PageHeader title="What do you need help with?" subtitle="Choose the kind of work. You will add the details next." />
      <Flash error={sp.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{TYPES.map(([v, l, d]) => <Link key={v} href={`/business/post?type=${v}`} className="rounded-2xl border border-border bg-surface p-5 hover:border-primary hover:bg-secondary/40"><h2 className="font-sans text-lg font-semibold">{l}</h2><p className="mt-1 text-sm text-muted">{d}</p></Link>)}</div>
    </>
  );

  const [cats, areas, skills] = await Promise.all([getCategories(), getAreas(), getSkills()]);
  const o = mine?.o; const sel = new Set(mine?.skills.map((s) => s.skillId)); const mand = new Set(mine?.skills.filter((s) => s.mandatory).map((s) => s.skillId));
  const needsSchedule = type === "recurring" || type === "flexible_shift";
  const dv = (c?: number | null) => (c ? c / 100 : "");
  return (
    <>
      <PageHeader title={`${mine ? "Edit" : "Post"}: ${ENGAGEMENT_LABELS[type]}`} subtitle="Clear scope and pay get better applicants. You will preview everything before it goes live." />
      <Flash error={sp.error} />
      {o?.status === "rejected" && o.moderationNote && <p className="mb-4 rounded-xl bg-[#fbe3e1] p-3 text-sm text-error"><strong>Needs changes:</strong> {o.moderationNote}</p>}
      <form action={saveOpportunityAction} className="space-y-6">
        <input type="hidden" name="engagementType" value={type} />{mine && <input type="hidden" name="id" value={mine.o.id} />}
        <Card className="space-y-4">
          <h2 className="font-sans text-lg font-semibold">The work</h2>
          <Field label="Title" htmlFor="title"><Input id="title" name="title" defaultValue={o?.title} required minLength={8} maxLength={120} /></Field>
          <Field label="Description" htmlFor="description" hint="At least 50 characters. What needs doing and why."><Textarea id="description" name="description" defaultValue={o?.description} required minLength={50} rows={6} /></Field>
          <Field label="Responsibilities (optional)" htmlFor="resp"><Textarea id="resp" name="responsibilities" defaultValue={o?.responsibilities ?? ""} rows={3} /></Field>
          <Field label={type === "fixed_project" ? "Deliverables (required)" : "Deliverables (optional)"} htmlFor="deliv" hint="Fixed-fee work needs a defined scope."><Textarea id="deliv" name="deliverables" defaultValue={o?.deliverables ?? ""} rows={3} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="cat"><Select id="cat" name="categoryId" defaultValue={o?.categoryId ?? ""} required><option value="" disabled>Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.requiresApproval ? " (needs approval)" : ""}</option>)}</Select></Field>
            <Field label="Experience required" htmlFor="exp"><Select id="exp" name="experienceLevel" defaultValue={o?.experienceLevel ?? "entry"}><option value="entry">Entry</option><option value="intermediate">Intermediate</option><option value="experienced">Experienced</option><option value="expert">Expert</option></Select></Field>
          </div>
          <fieldset><legend className="mb-2 text-sm font-semibold">Skills (tick “required” only for must-haves — required skills exclude candidates who lack them)</legend>
            <div className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">{skills.map((s) => <div key={s.id} className="flex items-center justify-between gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="skillIds" value={s.id} defaultChecked={sel.has(s.id)} className="size-4" />{s.name}</label><label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="mandatorySkillIds" value={s.id} defaultChecked={mand.has(s.id)} className="size-4" />required</label></div>)}</div></fieldset>
          <Field label="Qualifications required (optional)" htmlFor="q"><Input id="q" name="qualificationsRequired" defaultValue={o?.qualificationsRequired ?? ""} /></Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-sans text-lg font-semibold">Where</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work arrangement" htmlFor="arr"><Select id="arr" name="arrangement" defaultValue={o?.arrangement ?? (type === "local_service" ? "local" : "remote")}><option value="remote">Remote</option><option value="local">On-site (local)</option><option value="hybrid">Hybrid</option></Select></Field>
            <Field label="Approximate work area (local/hybrid)" htmlFor="area" hint="Only an area is shown publicly — never a street address."><Select id="area" name="serviceAreaId" defaultValue={o?.serviceAreaId ?? ""}><option value="">Not applicable (remote)</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Field label="Location note (optional)" htmlFor="ln"><Input id="ln" name="locationNote" defaultValue={o?.locationNote ?? ""} maxLength={200} placeholder="e.g. Near a C-Train station" /></Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-sans text-lg font-semibold">Pay</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Pay basis" htmlFor="pt"><Select id="pt" name="payType" defaultValue={o?.payType ?? PAY_OPTS[type][0][0]}>{PAY_OPTS[type].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Amount / minimum (CAD)" htmlFor="pmin"><Input id="pmin" name="payMin" type="number" step="0.01" min="0.01" defaultValue={dv(o?.payMinCents)} required /></Field>
            <Field label="Maximum (CAD, optional)" htmlFor="pmax" hint="Leave blank for a single amount."><Input id="pmax" name="payMax" type="number" step="0.01" min="0.01" defaultValue={o && o.payMaxCents !== o.payMinCents ? dv(o.payMaxCents) : ""} /></Field>
          </div>
          <p className="text-xs text-muted">Pay is shown to workers exactly as entered, with its basis (hourly, fixed, per shift or recurring). Vague descriptions like “competitive pay” are not accepted.</p>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-sans text-lg font-semibold">Timing</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estimated total hours" htmlFor="eh"><Input id="eh" name="estimatedHours" type="number" min={1} defaultValue={o?.estimatedHours ?? ""} /></Field>
            <Field label={type === "recurring" ? "Hours per week (required)" : "Hours per week"} htmlFor="hw"><Input id="hw" name="hoursPerWeek" type="number" min={1} max={80} defaultValue={o?.hoursPerWeek ?? ""} /></Field>
            <Field label="Workers needed" htmlFor="wn"><Input id="wn" name="workersNeeded" type="number" min={1} max={100} defaultValue={o?.workersNeeded ?? 1} /></Field>
            <Field label="Start date" htmlFor="sd"><Input id="sd" name="startDate" type="date" defaultValue={o?.startDate ?? ""} /></Field>
            <Field label="End date" htmlFor="ed"><Input id="ed" name="endDate" type="date" defaultValue={o?.endDate ?? ""} /></Field>
            <Field label="Apply by" htmlFor="ad"><Input id="ad" name="applicationDeadline" type="date" defaultValue={o?.applicationDeadline ?? ""} /></Field>
          </div>
          {type === "recurring" && <>
            <Field label="Recurrence" htmlFor="rn" hint="e.g. Every Tuesday for 3 months, renewable"><Input id="rn" name="recurrenceNote" defaultValue={o?.recurrenceNote ?? ""} /></Field>
            <Field label="When the term ends" htmlFor="psw" hint="You will get a reminder before the end date either way. Renewals always need the worker’s agreement."><Select id="psw" name="preferSameWorker" defaultValue={o?.preferSameWorker === false ? "no" : "yes"}><option value="yes">I’d like to renew with the same worker where possible</option><option value="no">I may look for someone different</option></Select></Field></>}
          {(needsSchedule || type === "micro_task" || type === "local_service") && <fieldset><legend className="mb-2 text-sm font-semibold">{needsSchedule ? "Scheduled days and hours (required)" : "Preferred days and hours (optional) — used to match workers who are actually available"}</legend>
            <div className="space-y-2">{DAYS.map((d, wd) => { const w = mine?.schedule.find((x) => x.weekday === wd); return <div key={d} className="grid items-center gap-2 sm:grid-cols-[110px_1fr_1fr]"><span className="text-sm font-semibold">{d}</span><Input aria-label={`${d} start`} type="time" name={`s_${wd}_0_start`} defaultValue={t(w?.startMinute)} /><Input aria-label={`${d} end`} type="time" name={`s_${wd}_0_end`} defaultValue={t(w?.endMinute === 1440 ? 0 : w?.endMinute)} /></div>; })}</div></fieldset>}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-sans text-lg font-semibold">Terms</h2>
          <Field label="Equipment requirements (optional)" htmlFor="eq"><Input id="eq" name="equipment" defaultValue={o?.equipment ?? ""} /></Field>
          <Field label="Selection process (optional)" htmlFor="sp"><Input id="sp" name="selectionProcess" defaultValue={o?.selectionProcess ?? ""} placeholder="e.g. Short chat, then offer" /></Field>
          <Field label="Cancellation terms (optional)" htmlFor="ct"><Textarea id="ct" name="cancellationTerms" rows={2} defaultValue={o?.cancellationTerms ?? ""} /></Field>
          <p className="rounded-xl bg-secondary/50 p-3 text-xs text-muted">You are responsible for the working arrangement you offer. Whether someone is an employee or independent contractor depends on the actual arrangement and applicable law, not on how it is listed here.</p>
        </Card>
        <Card className="space-y-3"><h2 className="font-sans text-lg font-semibold">Screening questions (optional, up to 5)</h2>
          <p className="text-xs text-muted">Applicants answer these when they apply. Avoid questions about age, family status, health, origin or other protected characteristics. Questions can’t be changed once someone has applied.</p>
          {[0, 1, 2, 3, 4].map((n) => <div key={n} className="grid items-center gap-2 sm:grid-cols-[1fr_auto]"><Input name={`q_${n}`} aria-label={`Question ${n + 1}`} defaultValue={mine?.questions[n]?.prompt ?? ""} maxLength={300} placeholder={n === 0 ? "e.g. Which accounting software have you used?" : ""} /><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`qreq_${n}`} defaultChecked={mine?.questions[n]?.required ?? true} className="size-4" />required</label></div>)}</Card>
        <div className="flex flex-wrap gap-3"><Button name="intent" value="publish" type="submit">Publish</Button><Button name="intent" value="draft" variant="outline" type="submit">Save draft</Button></div>
        <p className="text-xs text-muted">Sensitive categories, or all postings if moderation is enabled, go to a reviewer before they appear publicly.</p>
      </form>
    </>
  );
}
