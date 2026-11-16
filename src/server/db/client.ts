import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// NOTE: drizzle checks `client instanceof Pool` to run transactions on one dedicated connection,
// so this must be a real Pool (not a Proxy). Pool connects lazily on first query, so importing
// this module at build time is safe even without DATABASE_URL.
const g = globalThis as unknown as { __pool?: Pool };
export const getPool = (): Pool => (g.__pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));
export const db = drizzle(getPool(), { schema });
export type Db = typeof db;
export { schema };
