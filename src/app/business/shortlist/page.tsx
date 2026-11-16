import { requireUser } from "@/server/auth/session";
import { listShortlist } from "@/server/services/relationships";
import { Button, Card, EmptyState, Flash, LinkButton, PageHeader } from "@/components/ui";
import { shortlistAction } from "@/app/actions/collab";
export const metadata = { title: "Shortlist" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("business");
  const rows = await listShortlist(u.id);
  return (<><PageHeader title="Shortlisted talent" /><Flash error={sp.error} ok={sp.ok} />
    {rows.length === 0 ? <EmptyState title="Nobody shortlisted" body="Shortlist workers from Browse Talent or recommendations." action={<LinkButton href="/business/talent">Browse talent</LinkButton>} /> :
      <div className="space-y-3">{rows.map((r) => <Card key={r.workerId} className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{r.displayName}</p><p className="text-sm text-muted">{r.headline}</p></div><form action={shortlistAction}><input type="hidden" name="workerId" value={r.workerId} /><input type="hidden" name="remove" value="1" /><input type="hidden" name="back" value="/business/shortlist" /><Button variant="outline" type="submit">Remove</Button></form></Card>)}</div>}</>);
}
