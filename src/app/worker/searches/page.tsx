import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listSearches } from "@/server/services/saved-searches";
import { Badge, Button, Card, EmptyState, Flash, LinkButton, PageHeader } from "@/components/ui";
import { searchAlertsAction } from "@/app/actions/worker";
export const metadata = { title: "Saved searches" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams; const u = await requireUser("worker"); const rows = await listSearches(u.id);
  return (<><PageHeader title="Saved searches" subtitle="Alerts are a digest: at most one notification per search each time the alert job runs, never one per listing." /><Flash error={sp.error} ok={sp.ok} />
    {rows.length === 0 ? <EmptyState title="No saved searches" body="Filter opportunities, then choose “Save this search”." action={<LinkButton href="/opportunities">Browse opportunities</LinkButton>} /> :
      <div className="space-y-3">{rows.map((r) => <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3"><div><Link className="font-semibold hover:underline" href={`/opportunities?${new URLSearchParams(r.params as Record<string, string>)}`}>{r.name}</Link><p className="text-xs text-muted">{Object.entries(r.params as Record<string, string>).map(([k, v]) => `${k}: ${v.length > 20 ? v.slice(0, 8) + "…" : v}`).join(" · ")}</p></div>
        <div className="flex items-center gap-2"><Badge tone={r.alertsEnabled ? "success" : "outline"}>{r.alertsEnabled ? "alerts on" : "alerts off"}</Badge>
          <form action={searchAlertsAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="on" value={r.alertsEnabled ? "0" : "1"} /><Button variant="outline" type="submit">{r.alertsEnabled ? "Turn alerts off" : "Turn alerts on"}</Button></form>
          <form action={searchAlertsAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="delete" value="1" /><Button variant="ghost" type="submit">Delete</Button></form></div></Card>)}</div>}</>);
}
