import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getWorkerBundle, profileCompletion } from "@/server/services/worker";
import { recommendForWorker } from "@/server/services/matching";
import { listWorkerApplications } from "@/server/services/applications";
import { searchOpportunities, formatPay } from "@/server/services/opportunities";
import { Badge, Card, EmptyState, Flash, LinkButton, MatchRing, PageHeader, Stat } from "@/components/ui";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { opportunities } from "@/server/db/schema";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const b = await getWorkerBundle(user.id);
  if (!b.profile?.onboardingCompletedAt) redirect("/worker/onboarding");
  const [comp, recs, apps, notes] = await Promise.all([profileCompletion(user.id), recommendForWorker(user.id, 3), listWorkerApplications(user.id), db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(5)]);
  const recOpps = recs.length ? await db.select().from(opportunities).where(inArray(opportunities.id, recs.map((r) => r.id))) : [];
  const active = apps.filter((a) => !["withdrawn", "declined", "expired", "accepted"].includes(a.a.status));
  const accepted = apps.filter((a) => a.a.status === "accepted");
  const emailVerified = !!user.emailVerifiedAt;
  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName.split(" ")[0]}`} subtitle="Here is where things stand." action={<LinkButton href="/opportunities">Browse opportunities</LinkButton>} />
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Profile completion" value={`${comp.pct}%`} />
        <Stat label="Pending applications" value={active.length} />
        <Stat label="Accepted offers" value={accepted.length} />
        <Stat label="Earnings" value="—" hint="Payments are not active yet" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-sans text-lg font-semibold">Verification</h2>
          <p className="mt-2 text-sm"><Badge tone={emailVerified ? "success" : "warning"}>Email {emailVerified ? "verified" : "not verified"}</Badge></p>
          <p className="mt-2 text-xs text-muted">Other verification checks (identity, qualifications) are not available yet.</p>
        </Card>
        <Card>
          <h2 className="font-sans text-lg font-semibold">Current availability</h2>
          {b.profile?.availabilityPaused ? <p className="mt-2 text-sm"><Badge tone="warning">Paused</Badge> You are not being recommended to businesses.</p>
            : b.availability.length === 0 ? <p className="mt-2 text-sm text-muted">No weekly hours set. <Link className="underline" href="/worker/availability">Add availability</Link></p>
            : <ul className="mt-2 text-sm text-muted">{b.availability.sort((a, c) => a.weekday - c.weekday).map((a) => <li key={a.id}>{DAYS[a.weekday]} {hm(a.startMinute)}–{hm(a.endMinute)}</li>)}</ul>}
          <Link className="mt-2 inline-block text-sm font-semibold text-primary underline" href="/worker/availability">Edit availability</Link>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Recommended for you</h2>
      {recs.length === 0 ? <EmptyState title="No strong matches right now" body="Recommendations appear when an open opportunity fits your skills and real availability. Add skills or availability to see more." action={<LinkButton href="/worker/availability" variant="outline">Review availability</LinkButton>} />
        : <div className="space-y-3">{recs.map((r) => { const o = recOpps.find((x) => x.id === r.id)!; return <Card key={r.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><Link href={`/opportunities/${o.id}`} className="font-semibold hover:underline">{o.title}</Link><p className="text-sm text-primary">{formatPay(o)}</p></div><div className="flex items-center gap-2"><Badge tone={r.result.tier === "strong" ? "success" : "info"}>{r.result.tier}</Badge><MatchRing score={r.result.score} size={48} tone={r.result.tier === "strong" ? "good" : "look"} /></div></div><p className="mt-2 text-sm text-muted">{r.result.explanation}</p></Card>; })}<Link href="/worker/recommended" className="text-sm font-semibold text-primary underline">See all recommendations</Link></div>}
      <h2 className="mb-3 mt-8 text-xl font-semibold">Notifications</h2>
      {notes.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <ul className="space-y-2">{notes.map((n) => <li key={n.id} className="rounded-xl border border-border bg-surface p-3 text-sm"><strong>{n.title}</strong> — {n.body} {n.href && <Link className="underline" href={n.href}>View</Link>}</li>)}</ul>}
    </>
  );
}
