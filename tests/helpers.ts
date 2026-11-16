import { sql } from "drizzle-orm";
import { db, getPool } from "@/server/db/client";
import { Pool } from "pg";
import { runMigrations } from "../scripts/migrate";
import { seedReference } from "@/server/db/seed-data";
import { registerUser, verifyEmail } from "@/server/services/identity";
import { emailOutbox, users, categories, serviceAreas } from "@/server/db/schema";
import { desc, eq } from "drizzle-orm";

let ready = false;
export async function freshDb() {
  if (!ready) {
    const url = process.env.DATABASE_URL!;
    if (!/test/.test(url)) throw new Error("Refusing to run tests against non-test database");
    const p = new Pool({ connectionString: url });
    await p.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade;");
    await p.end();
    await runMigrations(url);
    await seedReference();
    ready = true;
  }
}
export const closeDb = () => getPool().end();

let n = 0;
export async function makeUser(kind: "worker" | "business", opts: { verify?: boolean; email?: string } = {}) {
  const email = opts.email ?? `u${Date.now()}${n++}@test.example`;
  const u = await registerUser({ kind, fullName: kind === "worker" ? "Test Worker" : "Test Owner", email, password: "CorrectHorse9", acceptTerms: true, businessName: kind === "business" ? `Biz ${n}` : undefined });
  if (opts.verify !== false) {
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email)).orderBy(desc(emailOutbox.createdAt)).limit(1);
    await verifyEmail(new URL(mail.link!).searchParams.get("token")!);
  }
  return (await db.select().from(users).where(eq(users.id, u.id)))[0];
}
export async function ref() {
  const cats = await db.select().from(categories);
  const areas = await db.select().from(serviceAreas);
  return { cat: cats.find((c) => !c.requiresApproval)!, regulatedCat: cats.find((c) => c.requiresApproval)!, area: areas[0], areas };
}
/** Raw SQL; unwraps drizzle's "Failed query" wrapper so the underlying Postgres error message is visible. */
export const q = (s: string) => db.execute(sql.raw(s)).catch((e) => { throw new Error(e?.cause?.message ?? e.message); });
