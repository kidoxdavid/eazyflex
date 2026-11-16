import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { applicationHistory, listWorkerApplications, WORKER_TRANSITIONS } from "@/server/services/applications";
import { Badge, Button, Card, EmptyState, Flash, LinkButton, PageHeader } from "@/components/ui";
import { workerApplicationStatusAction } from "@/app/actions/worker";
import { openConversationAction } from "@/app/actions/collab";

export const metadata = { title: "My applications" };
const tone = (s: string) => (s === "accepted" || s === "offer_received" ? "success" : s === "declined" || s === "withdrawn" || s === "expired" ? "error" : s === "shortlisted" || s === "interview_requested" ? "info" : "neutral") as "success";
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const apps = await listWorkerApplications(user.id);
  const hist = await Promise.all(apps.map((a) => applicationHistory(a.a.id)));
  return (
    <>
      <PageHeader title="My applications" />
      <Flash error={sp.error} ok={sp.ok} />
      {apps.length === 0 ? <EmptyState title="No applications yet" body="When you apply, you can track every status change here." action={<LinkButton href="/opportunities">Find work</LinkButton>} />
        : <div className="space-y-4">{apps.map((a, idx) => { const to = WORKER_TRANSITIONS[a.a.status] ?? [];
          return <Card key={a.a.id}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><Link href={`/opportunities/${a.oppId}`} className="text-lg font-semibold hover:underline">{a.title}</Link><p className="text-sm text-muted">{a.businessName}</p></div><Badge tone={tone(a.a.status)}>{a.a.status.replace(/_/g, " ")}</Badge></div>
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">History</summary><ol className="mt-2 space-y-1 text-muted">{hist[idx].map((h) => <li key={h.id}>{h.createdAt.toLocaleString("en-CA")} — {h.fromStatus ? `${h.fromStatus.replace(/_/g, " ")} → ` : ""}{h.toStatus.replace(/_/g, " ")}{h.note ? ` (${h.note})` : ""}</li>)}</ol></details>
            <form action={openConversationAction} className="mt-3"><input type="hidden" name="counterpartId" value={a.businessId} /><input type="hidden" name="opportunityId" value={a.oppId} /><input type="hidden" name="back" value="/worker/applications" /><Button variant="ghost" type="submit">Message business</Button></form>
            {a.a.status === "offer_received" && <p className="mt-3 rounded-xl bg-[#dff3e8] p-3 text-sm text-success">You received an offer. Accepting confirms your place; your assignment is now under My Assignments. Payment is not active in this release.</p>}
            {to.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{to.map((t) => <form key={t} action={workerApplicationStatusAction}><input type="hidden" name="applicationId" value={a.a.id} /><input type="hidden" name="to" value={t} /><Button variant={t === "accepted" ? "primary" : "outline"} type="submit">{t === "accepted" ? "Accept offer" : t === "declined" ? "Decline offer" : "Withdraw"}</Button></form>)}</div>}
          </Card>; })}</div>}
    </>
  );
}
