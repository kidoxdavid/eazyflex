import { requireUser } from "@/server/auth/session";
import { getWorkerBundle, profileCompletion } from "@/server/services/worker";
import { getAreas, getCategories, getSkills } from "@/server/services/catalog";
import { AboutForm, CompensationForm, PreferencesForm, Section } from "@/components/worker-forms";
import { Badge, Button, Field, Flash, Input, PageHeader, Textarea } from "@/components/ui";
import { addCertificationAction, addEducationAction, addExperienceAction, removeRowAction } from "@/app/actions/worker";

export const metadata = { title: "My profile" };
const Remove = ({ kind, id }: { kind: string; id: string }) => <form action={removeRowAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><Button variant="ghost" type="submit">Remove</Button></form>;
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const [b, skills, cats, areas, comp] = await Promise.all([getWorkerBundle(user.id), getSkills(), getCategories(), getAreas(), profileCompletion(user.id)]);
  return (
    <>
      <PageHeader title="My profile" subtitle={`${comp.pct}% complete`} />
      <Flash error={sp.error} ok={sp.ok} />
      <Section title="About you"><AboutForm b={b} skills={skills} /></Section>
      <Section title="Work preferences"><PreferencesForm b={b} cats={cats} areas={areas} /></Section>
      <Section title="Compensation preferences"><CompensationForm b={b} /></Section>
      <Section title="Work history">
        <ul className="mb-4 space-y-2 text-sm">{b.experience.map((e) => <li key={e.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2"><span><strong>{e.title}</strong>, {e.organisation} ({e.startYear}–{e.endYear ?? "present"})</span><Remove kind="experience" id={e.id} /></li>)}{b.experience.length === 0 && <li className="text-muted">None added.</li>}</ul>
        <form action={addExperienceAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title" htmlFor="et"><Input id="et" name="title" required /></Field><Field label="Organisation" htmlFor="eo"><Input id="eo" name="organisation" required /></Field>
          <Field label="Start year" htmlFor="es"><Input id="es" name="startYear" type="number" min={1950} max={2100} required /></Field><Field label="End year (blank if current)" htmlFor="ee"><Input id="ee" name="endYear" type="number" min={1950} max={2100} /></Field>
          <div className="sm:col-span-2"><Field label="Description (optional)" htmlFor="ed"><Textarea id="ed" name="description" rows={2} /></Field></div><div><Button type="submit">Add experience</Button></div>
        </form>
      </Section>
      <Section title="Education">
        <ul className="mb-4 space-y-2 text-sm">{b.education.map((e) => <li key={e.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2"><span><strong>{e.credential}</strong>, {e.institution} {e.year ?? ""}</span><Remove kind="education" id={e.id} /></li>)}{b.education.length === 0 && <li className="text-muted">None added.</li>}</ul>
        <form action={addEducationAction} className="grid gap-3 sm:grid-cols-3"><Field label="Institution" htmlFor="ei"><Input id="ei" name="institution" required /></Field><Field label="Credential" htmlFor="ec"><Input id="ec" name="credential" required /></Field><Field label="Year" htmlFor="ey"><Input id="ey" name="year" type="number" /></Field><div><Button type="submit">Add education</Button></div></form>
      </Section>
      <Section title="Certifications">
        <ul className="mb-4 space-y-2 text-sm">{b.certifications.map((c) => <li key={c.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2"><span><strong>{c.name}</strong> {c.issuer && `· ${c.issuer}`} <Badge tone={c.verificationStatus === "verified" ? "success" : "outline"}>{c.verificationStatus === "verified" ? "verified" : "self-declared"}</Badge></span><Remove kind="certification" id={c.id} /></li>)}{b.certifications.length === 0 && <li className="text-muted">None added.</li>}</ul>
        <form action={addCertificationAction} className="grid gap-3 sm:grid-cols-3"><Field label="Name" htmlFor="cn"><Input id="cn" name="name" required /></Field><Field label="Issuer" htmlFor="ci"><Input id="ci" name="issuer" /></Field><Field label="Year" htmlFor="cy"><Input id="cy" name="year" type="number" /></Field><div><Button type="submit">Add certification</Button></div></form>
        <p className="mt-2 text-xs text-muted">Certifications are shown as self-declared until a reviewer verifies evidence.</p>
      </Section>
    </>
  );
}
