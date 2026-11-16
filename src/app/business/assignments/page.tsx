import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listAssignments } from "@/server/services/assignments";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { STATUS_TONE, PAYSUFFIX, formatMoney } from "@/components/collab";
export const metadata = { title: "Assignments" };
export default async function Page() {
  const u = await requireUser("business");
  const rows = await listAssignments(u.id, "business");
  return (<><PageHeader title="Assignments" subtitle="Confirmed work from accepted offers." />
    {rows.length === 0 ? <EmptyState title="No assignments yet" body="An assignment is created when an offer is accepted." /> :
      <div className="space-y-3">{rows.map((r) => <Card key={r.a.id} className="flex flex-wrap items-center justify-between gap-2"><div><Link className="font-semibold hover:underline" href={`/business/assignments/${r.a.id}`}>{r.title}</Link><p className="text-sm text-muted">{r.workerName} · {formatMoney(r.a.agreedCents)}{PAYSUFFIX[r.a.payType]}</p></div><Badge tone={STATUS_TONE[r.a.status]}>{r.a.status.replace(/_/g, " ")}</Badge></Card>)}</div>}</>);
}
