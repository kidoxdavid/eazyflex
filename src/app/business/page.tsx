import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getBusinessForUser, listBusinessOpportunities } from "@/server/services/business";
import { Badge, Card, EmptyState, Flash, LinkButton, PageHeader, Stat } from "@/components/ui";
import { formatPay } from "@/server/services/opportunities";

const tone = (s: string) => (s === "published" ? "success" : s === "pending_review" ? "warning" : s === "rejected" ? "error" : "neutral") as "success";
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("business");
  const m = await getBusinessForUser(user.id);
  if (!m) return <EmptyState title="No business account" body="This login is not linked to a business." />;
  const opps = await listBusinessOpportunities(m.b.id);
  const live = opps.filter((o) => o.o.status === "published").length;
  const apps = opps.reduce((n, o) => n + o.applicants, 0);
  return (
    <>
      <PageHeader title={m.b.name} subtitle="Your hiring overview" action={<LinkButton href="/business/post">Post work</LinkButton>} />
      <Flash error={sp.error} ok={sp.ok} />
      {sp.welcome && <p className="mb-4 rounded-xl bg-secondary p-3 text-sm">Welcome! Complete your <Link className="underline" href="/business/profile">business profile</Link>, then post your first piece of work.</p>}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Active opportunities" value={live} /><Stat label="Total applications" value={apps} />
        <Stat label="Verification" value={<span className="text-xl capitalize">{m.b.verificationStatus.replace("_", " ")}</span>} />
        <Stat label="Spending" value="—" hint="Payments are not active yet" />
      </div>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Your opportunities</h2>
      {opps.length === 0 ? <EmptyState title="Nothing posted yet" body="Post a short task, project, shift or ongoing work to start receiving applications." action={<LinkButton href="/business/post">Post work</LinkButton>} />
        : <div className="space-y-3">{opps.map(({ o, applicants }) => <Card key={o.id} className="flex flex-wrap items-center justify-between gap-3"><div><Link className="font-semibold hover:underline" href={`/business/opportunities/${o.id}`}>{o.title}</Link><p className="text-sm text-muted">{formatPay(o)} · {applicants} applicant{applicants === 1 ? "" : "s"}</p></div><Badge tone={tone(o.status)}>{o.status.replace("_", " ")}</Badge></Card>)}</div>}
    </>
  );
}
