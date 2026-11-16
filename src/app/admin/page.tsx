import { requireAdmin } from "@/server/auth/session";
import { dashboardStats, type Actor } from "@/server/services/admin";
import { Badge, Card, Flash, PageHeader, Stat } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Admin dashboard" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const u = await requireAdmin("dashboard.view");
  const s = await dashboardStats({ id: u.id, kind: u.kind, adminRole: u.adminRole as Actor["adminRole"] });
  return (
    <>
      <PageHeader title="Platform dashboard" subtitle="Live counts from the database." />
      <Flash error={sp.error} />
      {s.demoUsers > 0 && <p className="mb-4"><Badge tone="warning">{s.demoUsers} demo accounts present (seeded development data)</Badge></p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registered workers" value={s.workers} hint={`${s.activeWorkers} signed in within 30 days`} />
        <Stat label="Businesses" value={s.bizTotal} hint={`${s.bizVerified} verified`} />
        <Stat label="Opportunities" value={s.opps} hint={`${s.oppsActive} live`} />
        <Stat label="Applications" value={s.apps} />
        <Stat label="Active assignments" value={s.assignActive} hint={`${s.assignDone} completed`} />
        <Stat label="Opportunities pending review" value={s.pendingOpps} />
        <Stat label="Verification queue" value={s.pendingVerif} />
        <Stat label="Suspended / restricted accounts" value={s.suspended} />
        <Card><p className="text-sm text-muted">Transactions, revenue, refunds, disputes</p><p className="mt-1 text-sm font-semibold">Not available — payments are not built yet.</p></Card>
      </div>
      <div className="mt-6 flex flex-wrap gap-4 text-sm">{s.pendingOpps > 0 && <Link className="underline" href="/admin/opportunities">Review pending opportunities →</Link>}{s.pendingVerif > 0 && <Link className="underline" href="/admin/verification">Open verification queue →</Link>}</div>
    </>
  );
}
