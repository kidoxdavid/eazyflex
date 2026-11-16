import Link from "next/link";
import { OpportunityCard } from "@/components/opportunity-card";
import { SearchBar } from "@/components/search-bar";
import { Button, EmptyState, Select, Input, Card, Flash } from "@/components/ui";
import { saveSearchAction } from "@/app/actions/worker";
import { cleanParams } from "@/server/services/saved-searches";
import { ENGAGEMENT_LABELS, PAY_LABELS, searchOpportunities } from "@/server/services/opportunities";
import { getSkills } from "@/server/services/catalog";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { savedOpportunities } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Explore opportunities", description: "Browse flexible remote, local, shift and recurring work." };
export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const [res, skills, saved] = await Promise.all([
    searchOpportunities({
      q: sp.q, category: sp.category || undefined, arrangement: sp.arrangement || undefined, engagementType: sp.engagementType || undefined, payType: sp.payType || undefined,
      minPay: sp.minPay ? Number(sp.minPay) : undefined, area: sp.area || undefined, skill: sp.skill || undefined, experience: sp.experience || undefined,
      recurring: sp.recurring === "1", weekday: sp.weekday ? Number(sp.weekday) : undefined, sort: (sp.sort as "newest") || "newest", page: Number(sp.page) || 1,
    }),
    getSkills(),
    user?.kind === "worker" ? db.select().from(savedOpportunities).where(eq(savedOpportunities.userId, user.id)) : Promise.resolve([]),
  ]);
  const savedIds = new Set(saved.map((s) => s.opportunityId));
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); u.set("page", String(p)); return `/opportunities?${u}`; };
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold sm:text-4xl">Explore opportunities</h1>
      <div className="mt-6"><Flash error={sp.error} ok={sp.ok} /><SearchBar defaults={sp} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        <form method="get" className="space-y-4 lg:sticky lg:top-28 lg:self-start" aria-label="More filters">
          <Card className="space-y-4">
            <h2 className="font-sans text-base font-semibold">Refine</h2>
            {["q", "arrangement", "area", "category"].map((k) => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}
            <label className="block text-sm font-semibold">Type of work<Select name="engagementType" defaultValue={sp.engagementType ?? ""} className="mt-1 font-normal"><option value="">Any</option>{Object.entries(ENGAGEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <label className="block text-sm font-semibold">Pay basis<Select name="payType" defaultValue={sp.payType ?? ""} className="mt-1 font-normal"><option value="">Any</option>{Object.entries(PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <label className="block text-sm font-semibold">Pay at least ($)<Input name="minPay" type="number" min="0" defaultValue={sp.minPay} className="mt-1 font-normal" /></label>
            <label className="block text-sm font-semibold">Skill<Select name="skill" defaultValue={sp.skill ?? ""} className="mt-1 font-normal"><option value="">Any</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
            <label className="block text-sm font-semibold">Experience<Select name="experience" defaultValue={sp.experience ?? ""} className="mt-1 font-normal"><option value="">Any</option><option value="entry">Entry</option><option value="intermediate">Intermediate</option><option value="experienced">Experienced</option><option value="expert">Expert</option></Select></label>
            <label className="block text-sm font-semibold">Scheduled on<Select name="weekday" defaultValue={sp.weekday ?? ""} className="mt-1 font-normal"><option value="">Any day</option>{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="recurring" value="1" defaultChecked={sp.recurring === "1"} className="size-5" /> Recurring only</label>
            <label className="block text-sm font-semibold">Sort by<Select name="sort" defaultValue={sp.sort ?? "newest"} className="mt-1 font-normal"><option value="newest">Newest</option><option value="pay">Highest pay</option><option value="relevance">Relevance (with search text)</option></Select></label>
            <Button type="submit" className="w-full">Apply filters</Button>
            <Link href="/opportunities" className="flex min-h-11 items-center justify-center text-sm underline">Clear all</Link>
          </Card>
        </form>
        <section aria-live="polite">
          {user?.kind === "worker" && Object.keys(cleanParams(sp)).length > 0 && (
            <details className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm"><summary className="cursor-pointer font-semibold">Save this search</summary>
              <form action={saveSearchAction} className="mt-2 flex flex-wrap items-end gap-3">{Object.entries(cleanParams(sp)).map(([k, v]) => <input key={k} type="hidden" name={`p_${k}`} value={v} />)}
                <label className="text-sm font-semibold">Name<Input name="name" required minLength={2} maxLength={80} className="mt-1 w-56 font-normal" /></label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="alerts" defaultChecked className="size-5" /> Alert me about new matches</label><Button type="submit">Save</Button></form></details>)}
          <p className="mb-3 text-sm text-muted">{res.total} {res.total === 1 ? "opportunity" : "opportunities"}</p>
          {res.items.length === 0
            ? <EmptyState title="No opportunities match those filters" body="Try removing a filter or searching a broader term." action={<Link className="font-semibold text-primary underline" href="/opportunities">Clear filters</Link>} />
            : <div className="grid gap-4 md:grid-cols-2">{res.items.map((i) => <OpportunityCard key={i.o.id} item={i} showSave={user?.kind === "worker"} saved={savedIds.has(i.o.id)} back="/opportunities" />)}</div>}
          {res.pages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
              {res.page > 1 && <Link className="rounded-xl border border-border bg-surface px-4 py-2 font-semibold" href={qs(res.page - 1)}>← Previous</Link>}
              <span className="text-sm text-muted">Page {res.page} of {res.pages}</span>
              {res.page < res.pages && <Link className="rounded-xl border border-border bg-surface px-4 py-2 font-semibold" href={qs(res.page + 1)}>Next →</Link>}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
