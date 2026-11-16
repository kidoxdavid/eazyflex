// After restoring a backup, re-apply erasures that happened after that backup was taken. Idempotent.
// Usage: LEDGER_FILE=/secure/deletions.jsonl DATABASE_URL=<restored db> npm run deletions:reapply
import "./env";
import fs from "node:fs";
import { anonymiseUser } from "../src/server/services/account";
import { getPool } from "../src/server/db/client";

async function main() {
  const file = process.env.LEDGER_FILE; if (!file || !fs.existsSync(file)) { console.error("Set LEDGER_FILE to an existing ledger export"); process.exit(1); }
  const ids = [...new Set(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).userId as string))];
  let applied = 0; for (const id of ids) if (await anonymiseUser(id, "restore_reapply")) applied++;
  console.log(`ledger entries: ${ids.length}; erasures re-applied now: ${applied}; already erased or absent: ${ids.length - applied}`);
  await getPool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
