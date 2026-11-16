import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { businesses, opportunities } from "@/server/db/schema";
import { Badge, Button, Card, Flash, Input, PageHeader } from "@/components/ui";
import { moderateAction } from "@/app/actions/admin";
import { formatPay } from "@/server/services/opportunities";

export const metadata = { title: "Opportunity moderation" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireAdmin("opportunities.moderate");
  const rows = await db.select({ o: opportunities, b: businesses.name }).from(opportunities).innerJoin(businesses, eq(businesses.id, opportunities.businessId)).where(inArray(opportunities.status, ["pending_review", "published", "paused"])).orderBy(desc(opportunities.updatedAt)).limit(100);
  const pending = rows.filter((r) => r.o.status === "pending_review");
  const others = rows.filter((r) => r.o.status !== "pending_review");
  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <Card><div className="flex flex-wrap justify-between gap-2"><div><Link href={`/opportunities/${r.o.id}`} className="font-semibold hover:underline">{r.o.title}</Link><p className="text-sm text-muted">{r.b} · {formatPay(r.o)}</p></div><Badge tone={r.o.status === "pending_review" ? "warning" : "neutral"}>{r.o.status.replace("_", " ")}</Badge></div>
      <form action={moderateAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.o.id} /><label className="text-sm font-semibold">Note (required to reject)<Input name="note" className="mt-1 w-72 font-normal" /></label>
        {r.o.status === "pending_review" && <><Button name="decision" value="approve" type="submit">Approve</Button><Button name="decision" value="reject" variant="danger" type="submit">Reject</Button></>}
        {r.o.status === "published" && <><Button name="decision" value="pause" variant="outline" type="submit">Pause</Button><Button name="decision" value="close" variant="outline" type="submit">Close</Button><Button name="decision" value={r.o.featured ? "unfeature" : "feature"} variant="secondary" type="submit">{r.o.featured ? "Unfeature" : "Feature"}</Button></>}
      </form></Card>
  );
  return (
    <>
      <PageHeader title="Opportunity moderation" />
      <Flash error={sp.error} ok={sp.ok} />
      <h2 className="mb-3 text-xl font-semibold">Pending review ({pending.length})</h2>
      <div className="space-y-3">{pending.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : pending.map((r) => <Row key={r.o.id} r={r} />)}</div>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Live and paused</h2>
      <div className="space-y-3">{others.map((r) => <Row key={r.o.id} r={r} />)}</div>
    </>
  );
}
