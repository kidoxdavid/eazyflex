// Appends any not-yet-exported erasures to a JSONL file (opaque ids only). Store the file OUTSIDE your database backups, with its own long retention:
// it is what lets you re-apply erasures after restoring an older backup.   Usage: LEDGER_FILE=/secure/deletions.jsonl npm run deletions:export
import "./env";
import fs from "node:fs";
import { asc } from "drizzle-orm";
import { db, getPool } from "../src/server/db/client";
import { deletionLedger } from "../src/server/db/schema";

async function main() {
  const file = process.env.LEDGER_FILE; if (!file) { console.error("Set LEDGER_FILE"); process.exit(1); }
  const have = new Set(fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).userId as string) : []);
  const rows = (await db.select().from(deletionLedger).orderBy(asc(deletionLedger.deletedAt))).filter((r) => !have.has(r.userId));
  fs.appendFileSync(file, rows.map((r) => JSON.stringify({ userId: r.userId, deletedAt: r.deletedAt.toISOString() })).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 });
  console.log(`exported ${rows.length} new erasure(s); ${have.size + rows.length} total in ${file}`);
  await getPool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
