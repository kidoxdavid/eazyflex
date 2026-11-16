// Used by scripts/restore-drill.sh: erases a seeded DEMO user through the real deletion path so the drill can prove erasures survive a restore.
import "./env";
import { eq } from "drizzle-orm";
import { deleteAccount } from "../src/server/services/account";
import { db, getPool } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the drill against production");
  const [j] = await db.select().from(users).where(eq(users.email, "jordan@demo.test"));
  if (!j || !j.isDemo) throw new Error("Seed demo data first (npm run db:seed): the drill erases the demo user jordan@demo.test");
  await deleteAccount(j.id, "DemoPass2026!", "DELETE"); console.log(j.id); await getPool().end();
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
