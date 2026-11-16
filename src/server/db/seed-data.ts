import { db as defaultDb } from "./client";
import { categories, matchingRules, platformSettings, serviceAreas, skills } from "./schema";
import { DEFAULT_RULES } from "../matching/score";

export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Initial taxonomy from the product brief. Everything here is editable in the admin portal. */
export const TAXONOMY: { name: string; requiresApproval?: boolean; skills: string[] }[] = [
  { name: "Administration & business support", skills: ["Virtual assistance", "Data entry", "Spreadsheet work", "Document preparation", "Scheduling", "Email management", "Bookkeeping support", "Invoice processing", "Customer follow-up", "Research", "CRM administration", "Excel"] },
  { name: "Digital & creative", skills: ["Graphic design", "Social media management", "Content creation", "Video editing", "Copywriting", "Photography", "Website support", "Product listing", "Digital marketing"] },
  { name: "Customer service", skills: ["Customer support", "Telephone support", "Chat support", "Appointment booking", "Order processing", "Reception support"] },
  { name: "Education", requiresApproval: true, skills: ["Tutoring", "Homework assistance", "Language instruction", "Music lessons", "Educational content", "Mentoring"] },
  { name: "Local services", skills: ["Event assistance", "Errands", "Pet care", "Home organisation", "Shopping assistance", "General assistance"] },
  { name: "Specialist expertise", skills: ["Accounting support", "HR administration", "Operations consulting", "Project coordination", "Procurement support", "Data analysis", "IT support", "Business mentoring"] },
  { name: "Physical & operational work", skills: ["Retail assistance", "Inventory counting", "Product packaging", "Stock organisation", "Event setup", "Warehouse support", "Quality inspection"] },
];

export const AREAS = [
  { slug: "calgary-downtown", name: "Calgary – Downtown / Beltline", lat: "51.0447", lng: "-114.0719" },
  { slug: "calgary-nw", name: "Calgary – Northwest", lat: "51.0905", lng: "-114.1500" },
  { slug: "calgary-ne", name: "Calgary – Northeast", lat: "51.0900", lng: "-113.9600" },
  { slug: "calgary-sw", name: "Calgary – Southwest", lat: "50.9800", lng: "-114.1100" },
  { slug: "calgary-se", name: "Calgary – Southeast", lat: "50.9600", lng: "-114.0000" },
  { slug: "airdrie", name: "Airdrie", lat: "51.2917", lng: "-114.0144" },
  { slug: "cochrane", name: "Cochrane", lat: "51.1894", lng: "-114.4669" },
];

/** Idempotent reference data: taxonomy, service areas, default matching rules, platform settings. */
export async function seedReference(db: typeof defaultDb = defaultDb) {
  await db.insert(serviceAreas).values(AREAS.map((a) => ({ ...a, city: a.name.startsWith("Calgary") ? "Calgary" : a.name, region: "AB" }))).onConflictDoNothing();
  let order = 0;
  for (const c of TAXONOMY) {
    const [cat] = await db.insert(categories).values({ slug: slugify(c.name), name: c.name, requiresApproval: !!c.requiresApproval, sortOrder: order++ })
      .onConflictDoUpdate({ target: categories.slug, set: { name: c.name } }).returning();
    await db.insert(skills).values(c.skills.map((s) => ({ slug: slugify(s), name: s, categoryId: cat.id }))).onConflictDoNothing();
  }
  await db.insert(matchingRules).values({ version: 1, weights: DEFAULT_RULES.weights, thresholds: { ...DEFAULT_RULES.thresholds, mandatory: DEFAULT_RULES.mandatory }, active: true, note: "Initial default rules" }).onConflictDoNothing();
  await db.insert(platformSettings).values([
    { key: "moderation.all_postings", value: false },
    { key: "brand.override", value: {} },
  ]).onConflictDoNothing();
}
