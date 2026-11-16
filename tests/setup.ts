import fs from "node:fs";
for (const f of [".env.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
// Tests must never touch the dev database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/eazyflex_test";
