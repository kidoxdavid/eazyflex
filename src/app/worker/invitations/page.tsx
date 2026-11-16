import { requireUser } from "@/server/auth/session";
import { listWorkerInvitations } from "@/server/services/relationships";
import { Badge, Button, Card, EmptyState, Flash, LinkButton, PageHeader } from "@/components/ui";
import { declineInvitationAction } from "@/app/actions/collab";
export const metadata = { title: "Invitations" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("worker");
  const rows = await listWorkerInvitations(u.id);
  return (<><PageHeader title="Invitations" subtitle="Businesses that invited you to apply. You are never obliged to respond." /><Flash error={sp.error} ok={sp.ok} />
    {rows.length === 0 ? <EmptyState title="No invitations" body="Businesses can invite you if you’re discoverable and a match." /> :
      <div className="space-y-3">{rows.map(({ i, title, businessName, oppStatus }) => <Card key={i.id}><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{title}</p><p className="text-sm text-muted">{businessName}</p></div><Badge tone={i.status === "pending" ? "info" : "neutral"}>{i.status}</Badge></div>{i.message && <p className="mt-2 text-sm">“{i.message}”</p>}
        {i.status === "pending" && <div className="mt-3 flex gap-2">{oppStatus === "published" && <LinkButton href={`/opportunities/${i.opportunityId}`}>View &amp; apply</LinkButton>}<form action={declineInvitationAction}><input type="hidden" name="id" value={i.id} /><Button variant="outline" type="submit">Decline</Button></form></div>}</Card>)}</div>}</>);
}
