import { desc } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { matchingRules } from "@/server/db/schema";
import { loadActiveRules } from "@/server/services/matching";
import { Badge, Button, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { publishRulesAction } from "@/app/actions/admin";

export const metadata = { title: "Matching rules" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin("matching.configure");
  const [rules, history] = await Promise.all([loadActiveRules(), db.select().from(matchingRules).orderBy(desc(matchingRules.version)).limit(10)]);
  const w = rules.weights as Record<string, number>;
  return (
    <>
      <PageHeader title="Matching rules" subtitle={`Active version ${rules.version}. Publishing creates a new immutable version and is audit-logged.`} />
      <Flash error={sp.error} ok={sp.ok} />
      <Card>
        <form action={publishRulesAction} className="space-y-5">
          <fieldset><legend className="mb-2 font-sans font-semibold">Weights (relative importance; only assessable criteria count)</legend>
            <div className="grid gap-3 sm:grid-cols-4">{Object.keys(w).map((k) => <Field key={k} label={k} htmlFor={`w_${k}`}><Input id={`w_${k}`} name={`w_${k}`} type="number" min={0} max={100} defaultValue={w[k]} /></Field>)}</div></fieldset>
          <fieldset><legend className="mb-2 font-sans font-semibold">Thresholds</legend>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Recommend at or above" htmlFor="tr"><Input id="tr" name="t_recommend" type="number" min={0} max={100} defaultValue={rules.thresholds.recommend} /></Field><Field label="“Strong” at or above" htmlFor="ts"><Input id="ts" name="t_strong" type="number" min={0} max={100} defaultValue={rules.thresholds.strong} /></Field></div></fieldset>
          <fieldset><legend className="mb-2 font-sans font-semibold">Mandatory requirements (failing any excludes the worker)</legend>
            <div className="flex flex-wrap gap-4">{[["skills", "Required skills"], ["availability", "Availability for required hours"], ["location", "Travel radius"], ["hardMinRate", "Worker’s hard minimum rate"]].map(([v, l]) => <label key={v} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mandatory" value={v} defaultChecked={rules.mandatory?.includes(v as "skills")} className="size-5" />{l}</label>)}</div></fieldset>
          <Field label="Change note" htmlFor="note"><Input id="note" name="note" maxLength={300} /></Field>
          <Button type="submit">Publish new version</Button>
        </form>
      </Card>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Version history</h2>
      <ul className="space-y-2 text-sm">{history.map((h) => <li key={h.id} className="rounded-xl border border-border bg-surface p-3">v{h.version} {h.active && <Badge tone="success">active</Badge>} · {h.createdAt.toLocaleString("en-CA")} · {h.note ?? "—"}</li>)}</ul>
    </>
  );
}
