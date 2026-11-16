import Link from "next/link";
import { inArray } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { recommendForWorker } from "@/server/services/matching";
import { db } from "@/server/db/client";
import { opportunities } from "@/server/db/schema";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatPay } from "@/server/services/opportunities";

export const metadata = { title: "Recommended for me" };
export default async function Page() {
  const user = await requireUser("worker");
  const recs = await recommendForWorker(user.id, 30);
  const opps = recs.length ? await db.select().from(opportunities).where(inArray(opportunities.id, recs.map((r) => r.id))) : [];
  return (
    <>
      <PageHeader title="Recommended for me" subtitle="Matched against your real availability, skills, location and preferences. Every score is explained — and you decide what to apply for." />
      {recs.length === 0 ? <EmptyState title="No recommendations yet" body="We only recommend opportunities where required skills and your availability genuinely fit. Try adding skills or widening your availability." action={<LinkButton variant="outline" href="/worker/availability">Edit availability</LinkButton>} />
        : <div className="space-y-4">{recs.map((r) => { const o = opps.find((x) => x.id === r.id)!;
          return <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-sans text-lg font-semibold"><Link className="hover:underline" href={`/opportunities/${o.id}`}>{o.title}</Link></h2><p className="font-display text-primary">{formatPay(o)}</p></div><Badge tone={r.result.tier === "strong" ? "success" : r.result.tier === "good" ? "info" : "warning"}>{r.result.score}/100 · {r.result.tier} match</Badge></div>
            <p className="mt-3 text-sm">{r.result.explanation}</p>
            <p className="mt-1 text-xs text-muted">Score is based on {Math.round(r.result.coverage * 100)}% of the matching criteria — criteria the listing or your profile doesn’t specify are not counted.</p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{r.result.reasons.map((x, i) => <li key={i} className="flex gap-2"><span aria-hidden>{x.status === "match" ? "✅" : x.status === "partial" ? "🟡" : x.status === "gap" ? "⚠️" : "•"}</span><span className="text-muted"><span className="sr-only">{x.status}: </span>{x.text}</span></li>)}</ul>
            <div className="mt-4"><LinkButton href={`/opportunities/${o.id}`}>View &amp; apply</LinkButton></div>
          </Card>; })}</div>}
    </>
  );
}
