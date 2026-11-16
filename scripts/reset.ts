import "./env";
import { Pool } from "pg";
import { runMigrations } from "./migrate";
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
async function main() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade;");
  await pool.end();
  await runMigrations(url);
  console.log("Database reset and migrated. Run `npm run db:seed` to load demonstration data.");
}
main();
