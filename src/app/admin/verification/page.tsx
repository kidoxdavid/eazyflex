import { desc, eq, inArray, ne, and } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { businesses, users, verifications } from "@/server/db/schema";
import { Badge, Button, Card, Flash, Input, PageHeader } from "@/components/ui";
import { verificationDecisionAction } from "@/app/actions/admin";

export const metadata = { title: "Verification queue" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireAdmin("verification.decide");
  const rows = await db.select({ v: verifications, biz: businesses.name, who: users.fullName }).from(verifications)
    .leftJoin(businesses, eq(businesses.id, verifications.businessId)).leftJoin(users, eq(users.id, verifications.userId))
    .where(and(ne(verifications.type, "email"), inArray(verifications.status, ["submitted", "requires_review", "pending"]))).orderBy(desc(verifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader title="Verification queue" subtitle="Only a decision recorded here makes a badge appear." />
      <Flash error={sp.error} ok={sp.ok} />
      {rows.length === 0 ? <p className="text-sm text-muted">The queue is empty.</p> : <div className="space-y-3">{rows.map(({ v, biz, who }) => <Card key={v.id}>
        <div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{biz ?? who} <span className="text-sm font-normal text-muted">— {v.type.replace("_", " ")}</span></p><p className="mt-1 text-sm text-muted">{v.notes}</p></div><Badge tone="warning">{v.status.replace("_", " ")}</Badge></div>
        <form action={verificationDecisionAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={v.id} /><label className="text-sm font-semibold">Notes<Input name="notes" className="mt-1 w-72 font-normal" /></label>
          <Button name="decision" value="verified" type="submit">Verify</Button><Button name="decision" value="requires_review" variant="outline" type="submit">Needs review</Button><Button name="decision" value="rejected" variant="danger" type="submit">Reject</Button></form>
      </Card>)}</div>}
    </>
  );
}
