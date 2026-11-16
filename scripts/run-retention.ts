import "./env";
import { runRetention } from "../src/server/services/retention";
import { getPool } from "../src/server/db/client";
runRetention().then((r) => { console.log("retention:", JSON.stringify(r)); return getPool().end(); });
