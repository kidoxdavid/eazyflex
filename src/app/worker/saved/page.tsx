import { desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { savedOpportunities } from "@/server/db/schema";
import { searchOpportunities } from "@/server/services/opportunities";
import { OpportunityCard } from "@/components/opportunity-card";
import { EmptyState, Flash, LinkButton, PageHeader } from "@/components/ui";
import { opportunities } from "@/server/db/schema";

export const metadata = { title: "Saved opportunities" };
export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("worker");
  const saved = await db.select().from(savedOpportunities).where(eq(savedOpportunities.userId, user.id)).orderBy(desc(savedOpportunities.createdAt));
  const ids = saved.map((s) => s.opportunityId);
  // Only still-published opportunities are shown (closed/unpublished ones disappear from the list).
  const all = ids.length ? (await searchOpportunities({ ids, pageSize: 50 })).items : [];
  return (
    <>
      <PageHeader title="Saved opportunities" />
      <Flash error={sp.error} ok={sp.ok} />
      {all.length === 0 ? <EmptyState title="Nothing saved yet" body="Use ☆ Save on any opportunity to keep it here." action={<LinkButton href="/opportunities">Browse opportunities</LinkButton>} />
        : <div className="grid gap-4 md:grid-cols-2">{all.map((i) => <OpportunityCard key={i.o.id} item={i} showSave saved back="/worker/saved" />)}</div>}
    </>
  );
}
