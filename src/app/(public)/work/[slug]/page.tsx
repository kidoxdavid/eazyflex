import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { categories } from "@/server/db/schema";
import { searchOpportunities } from "@/server/services/opportunities";
import { OpportunityCard } from "@/components/opportunity-card";
import { LinkButton } from "@/components/ui";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c] = await db.select().from(categories).where(eq(categories.slug, slug));
  return c ? { title: `${c.name} — flexible work in ${brand.launchCity}`, description: `Flexible ${c.name.toLowerCase()} opportunities: remote, local, short shifts and recurring work.`, alternates: { canonical: `/work/${slug}` } } : { title: "Not found", robots: { index: false } };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c] = await db.select().from(categories).where(eq(categories.slug, slug));
  if (!c || !c.active) notFound();
  const res = await searchOpportunities({ category: c.id, pageSize: 24 });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-4xl font-semibold">{c.name}</h1>
      <p className="mt-3 max-w-2xl text-muted">Flexible {c.name.toLowerCase()} opportunities, including remote, local, short-shift and recurring work in {brand.launchCity} and beyond.</p>
      {res.items.length ? <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{res.items.map((i) => <OpportunityCard key={i.o.id} item={i} />)}</div>
        : <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-muted">No open opportunities in this category right now.<div className="mt-4"><LinkButton href="/register?type=worker">Create an account to be ready to apply</LinkButton></div></div>}
    </div>
  );
}
