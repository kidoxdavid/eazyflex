import { requireUser } from "@/server/auth/session";
import { browseTalent, talentFilterSchema } from "@/server/services/business";
import { getAreas, getSkills } from "@/server/services/catalog";
import { Badge, Button, Card, EmptyState, Flash, Input, PageHeader, Select } from "@/components/ui";
import { formatMoney } from "@/server/services/opportunities";
import { inviteAction, shortlistAction } from "@/app/actions/collab";
import { getBusinessForUser, listBusinessOpportunities } from "@/server/services/business";
import { workerRatingSummary } from "@/server/services/assignments";

export const metadata = { title: "Browse talent" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser("business");
  const parsed = talentFilterSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)));
  const [talent, skills, areas] = await Promise.all([browseTalent(user.id, parsed.success ? parsed.data : {}), getSkills(), getAreas()]);
  const m = await getBusinessForUser(user.id);
  const live = m ? (await listBusinessOpportunities(m.b.id)).filter((x) => x.o.status === "published") : [];
  const ratings = await workerRatingSummary(talent.map((t) => t.workerId));
  return (
    <>
      <Flash error={sp.error} ok={sp.ok} />
      <PageHeader title="Browse talent" subtitle="Workers who chose to be discoverable. You see a first name and initial, skills and availability — never contact details or addresses." />
      <form className="mb-6 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-5" role="search">
        <Input name="q" placeholder="Keyword" defaultValue={sp.q} aria-label="Keyword" />
        <Select name="skill" defaultValue={sp.skill ?? ""} aria-label="Skill"><option value="">Any skill</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select name="arrangement" defaultValue={sp.arrangement ?? ""} aria-label="Arrangement"><option value="">Remote or local</option><option value="remote">Remote</option><option value="local">Local</option><option value="hybrid">Hybrid</option></Select>
        <Select name="area" defaultValue={sp.area ?? ""} aria-label="Area"><option value="">Any area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <Button type="submit">Search</Button>
      </form>
      {talent.length === 0 ? <EmptyState title="No matching talent" body="Try fewer filters. Only workers who completed onboarding and opted in appear here." />
        : <div className="grid gap-4 md:grid-cols-2">{talent.map((t) => <Card key={t.workerId}>
          <h2 className="font-sans text-lg font-semibold">{t.displayName}</h2><p className="text-sm text-muted">{t.headline}</p>
          <p className="mt-2 text-sm">{t.area ?? "Area not set"} · {t.arrangements.join("/") || "—"} · {t.experienceLevel}{t.preferredHourlyCents ? ` · ${formatMoney(t.preferredHourlyCents)}/h preferred` : ""}</p>
          <p className="mt-2 text-sm text-muted">{t.skills.join(" · ")}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{t.verified.length ? t.verified.map((v) => <Badge key={v} tone="success">✓ {v.replace("_", " ")} verified</Badge>) : <Badge tone="outline">No verified checks</Badge>}</div>
          <p className="mt-2 text-xs text-muted">{ratings.get(t.workerId) ? `★ ${ratings.get(t.workerId)!.avg} (${ratings.get(t.workerId)!.count} review${ratings.get(t.workerId)!.count > 1 ? "s" : ""})` : "No published reviews yet"}</p>
          <div className="mt-3 flex flex-wrap gap-2"><form action={shortlistAction}><input type="hidden" name="workerId" value={t.workerId} /><Button variant="outline" type="submit">Shortlist</Button></form>
            {live.length > 0 && <form action={inviteAction} className="flex gap-2"><input type="hidden" name="workerId" value={t.workerId} /><Select name="opportunityId" aria-label="Opportunity" className="min-h-11 w-44">{live.map((x) => <option key={x.o.id} value={x.o.id}>{x.o.title}</option>)}</Select><Button variant="secondary" type="submit">Invite</Button></form>}</div>
        </Card>)}</div>}
      <p className="mt-6 text-xs text-muted">Messaging opens once a worker applies, accepts an invitation or has an assignment with you.</p>
    </>
  );
}
