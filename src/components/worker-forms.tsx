import { Button, Field, Input, Select, Textarea, Card } from "./ui";
import { saveAboutAction, savePreferencesAction, saveCompensationAction, saveAvailabilityAction } from "@/app/actions/worker";
import type { getWorkerBundle } from "@/server/services/worker";
import { HoursPresets } from "./hours-presets";

type Bundle = Awaited<ReturnType<typeof getWorkerBundle>>;
type Ref = { id: string; name: string }[];
type Nav = { returnTo?: string; failTo?: string };
const Hidden = ({ returnTo, failTo }: Nav) => <>{returnTo && <input type="hidden" name="returnTo" value={returnTo} />}{failTo && <input type="hidden" name="failTo" value={failTo} />}</>;
export const ENG = [["micro_task", "Short tasks"], ["fixed_project", "Projects with a set fee"], ["flexible_shift", "Shifts"], ["recurring", "Ongoing work"], ["specialist_consultation", "Expert advice"], ["local_service", "Local jobs"]] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const t = (m?: number) => (m === undefined ? "" : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

export function AboutForm({ b, skills, nav, submit = "Save" }: { b: Bundle; skills: (Ref[number] & { categoryId?: string | null })[]; nav?: Nav; submit?: string }) {
  const have = new Set(b.skills.map((s) => s.id));
  return (
    <form action={saveAboutAction} className="space-y-4"><Hidden {...nav} />
      <Field label="Professional headline" htmlFor="headline"><Input id="headline" name="headline" defaultValue={b.profile?.headline ?? ""} required maxLength={120} placeholder="e.g. Virtual assistant with 10 years in operations" /></Field>
      <Field label="Summary" htmlFor="summary" hint="Describe your real experience. Only include what is true."><Textarea id="summary" name="summary" defaultValue={b.profile?.summary ?? ""} required minLength={30} rows={5} /></Field>
      <Field label="Experience level" htmlFor="lvl"><Select id="lvl" name="experienceLevel" defaultValue={b.profile?.experienceLevel ?? "intermediate"}><option value="entry">Entry</option><option value="intermediate">Intermediate</option><option value="experienced">Experienced</option><option value="expert">Expert</option></Select></Field>
      <fieldset><legend className="mb-2 text-sm font-semibold">Skills</legend>
        <div className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">{skills.map((s) => <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="skillIds" value={s.id} defaultChecked={have.has(s.id)} className="size-4" />{s.name}</label>)}</div></fieldset>
      <Field label="Languages" htmlFor="lang" hint="Comma-separated"><Input id="lang" name="languages" defaultValue={b.profile?.languages.join(", ")} placeholder="English, French" /></Field>
      <Field label="Portfolio links" htmlFor="pl" hint="One https:// link per line or separated by spaces"><Textarea id="pl" name="portfolioLinks" rows={2} defaultValue={b.profile?.portfolioLinks.join("\n")} /></Field>
      <Button type="submit">{submit}</Button>
    </form>
  );
}

export function PreferencesForm({ b, cats, areas, nav, submit = "Save" }: { b: Bundle; cats: Ref; areas: Ref; nav?: Nav; submit?: string }) {
  const p = b.profile;
  return (
    <form action={savePreferencesAction} className="space-y-4"><Hidden {...nav} />
      <fieldset><legend className="mb-2 text-sm font-semibold">Where do you want to work?</legend>
        <div className="flex flex-wrap gap-3">{[["remote", "Remote"], ["local", "Local (on-site)"], ["hybrid", "Hybrid"]].map(([v, l]) => <label key={v} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><input type="checkbox" name="arrangements" value={v} defaultChecked={p?.arrangements.includes(v)} className="size-4" />{l}</label>)}</div></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">Kinds of work</legend>
        <div className="flex flex-wrap gap-3">{ENG.map(([v, l]) => <label key={v} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><input type="checkbox" name="engagementTypes" value={v} defaultChecked={p?.engagementTypes.includes(v)} className="size-4" />{l}</label>)}</div></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">Categories</legend>
        <div className="grid gap-1 sm:grid-cols-2">{cats.map((c) => <label key={c.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="categoryIds" value={c.id} defaultChecked={p?.categoryIds.includes(c.id)} className="size-4" />{c.name}</label>)}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your service area" htmlFor="area" hint="Required for local or hybrid work. We never show your address."><Select id="area" name="serviceAreaId" defaultValue={p?.serviceAreaId ?? ""}><option value="">Not set</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Maximum travel distance (km)" htmlFor="rad"><Input id="rad" name="travelRadiusKm" type="number" min={1} max={200} defaultValue={p?.travelRadiusKm ?? 15} /></Field>
      </div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="publicProfile" defaultChecked={p?.publicProfile ?? true} className="mt-0.5 size-5" /><span><strong>Let verified-email businesses discover me.</strong> They see your first name and last initial, headline, skills, area and availability — never your email, phone or address.</span></label>
      <Button type="submit">{submit}</Button>
    </form>
  );
}

export function CompensationForm({ b, nav, submit = "Save" }: { b: Bundle; nav?: Nav; submit?: string }) {
  const p = b.profile; const d = (c?: number | null) => (c ? c / 100 : "");
  return (
    <form action={saveCompensationAction} className="space-y-4"><Hidden {...nav} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Preferred hourly rate (CAD)" htmlFor="ph"><Input id="ph" name="preferredHourly" type="number" step="0.01" min="0" defaultValue={d(p?.preferredHourlyCents)} /></Field>
        <Field label="Minimum hourly rate (CAD)" htmlFor="mh"><Input id="mh" name="minHourly" type="number" step="0.01" min="0" defaultValue={d(p?.minHourlyCents)} /></Field>
        <Field label="Preferred project fee (CAD)" htmlFor="pf"><Input id="pf" name="preferredFixed" type="number" step="1" min="0" defaultValue={d(p?.preferredFixedCents)} /></Field>
      </div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="minHourlyIsHard" defaultChecked={p?.minHourlyIsHard} className="mt-0.5 size-5" /><span><strong>Treat my minimum as a hard limit.</strong> If unchecked, lower-paying work can still be recommended (with a note).</span></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="willingToNegotiate" defaultChecked={p?.willingToNegotiate ?? true} className="size-5" />I am willing to negotiate</label>
      <Button type="submit">{submit}</Button>
    </form>
  );
}

export function AvailabilityForm({ b, nav, submit = "Save availability" }: { b: Bundle; nav?: Nav; submit?: string }) {
  const p = b.profile;
  return (
    <form id="availability-form" action={saveAvailabilityAction} className="space-y-5"><Hidden {...nav} />
      <HoursPresets formId="availability-form" />
      <label className="flex items-start gap-3 rounded-xl bg-secondary/50 p-3 text-sm"><input type="checkbox" name="availabilityPaused" defaultChecked={p?.availabilityPaused} className="mt-0.5 size-5" /><span><strong>Pause my availability.</strong> You will not be recommended or listed to businesses until you turn this off.</span></label>
      <fieldset><legend className="mb-2 text-sm font-semibold">Weekly hours (up to two windows per day, leave blank if unavailable)</legend>
        <div className="space-y-2">{DAYS.map((d, wd) => {
          const w = b.availability.filter((a) => a.weekday === wd).sort((a, c) => a.startMinute - c.startMinute);
          return <div key={d} className="grid items-center gap-2 rounded-xl border border-border p-2 sm:grid-cols-[110px_1fr_1fr]"><span className="text-sm font-semibold">{d}</span>
            {[0, 1].map((s) => <div key={s} className="flex items-center gap-2"><label className="sr-only" htmlFor={`w_${wd}_${s}_start`}>{d} window {s + 1} start</label><Input id={`w_${wd}_${s}_start`} type="time" name={`w_${wd}_${s}_start`} defaultValue={t(w[s]?.startMinute)} /><span aria-hidden>–</span><label className="sr-only" htmlFor={`w_${wd}_${s}_end`}>{d} window {s + 1} end</label><Input id={`w_${wd}_${s}_end`} type="time" name={`w_${wd}_${s}_end`} defaultValue={t(w[s]?.endMinute === 1440 ? 0 : w[s]?.endMinute)} /></div>)}</div>;
        })}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Max hours per week" htmlFor="mhw"><Input id="mhw" name="maxHoursPerWeek" type="number" min={1} max={80} defaultValue={p?.maxHoursPerWeek ?? ""} /></Field>
        <Field label="Shortest assignment (days)" htmlFor="mind"><Input id="mind" name="minAssignmentDays" type="number" min={1} defaultValue={p?.minAssignmentDays ?? ""} /></Field>
        <Field label="Longest assignment (days)" htmlFor="maxd"><Input id="maxd" name="maxAssignmentDays" type="number" min={1} defaultValue={p?.maxAssignmentDays ?? ""} /></Field>
      </div>
      <Field label="Time zone" htmlFor="tz"><Select id="tz" name="timezone" defaultValue={p?.timezone ?? "America/Edmonton"}>{["America/Edmonton", "America/Vancouver", "America/Winnipeg", "America/Toronto", "America/Halifax", "America/St_Johns"].map((z) => <option key={z}>{z}</option>)}</Select></Field>
      <Button type="submit">{submit}</Button>
    </form>
  );
}

export const Section = ({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) => <Card className="mb-5"><h2 id={id} className="mb-4 font-sans text-lg font-semibold">{title}</h2>{children}</Card>;
