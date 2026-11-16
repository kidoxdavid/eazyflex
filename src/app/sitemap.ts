import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { categories, opportunities } from "@/server/db/schema";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const [opps, cats] = await Promise.all([db.select({ id: opportunities.id, u: opportunities.updatedAt }).from(opportunities).where(eq(opportunities.status, "published")), db.select().from(categories).where(eq(categories.active, true))]);
  return [
    ...["", "/find-work", "/hire-talent", "/how-it-works", "/opportunities", "/about", "/help"].map((p) => ({ url: base + p })),
    ...cats.map((c) => ({ url: `${base}/work/${c.slug}` })),
    ...opps.map((o) => ({ url: `${base}/opportunities/${o.id}`, lastModified: o.u })),
  ];
}
