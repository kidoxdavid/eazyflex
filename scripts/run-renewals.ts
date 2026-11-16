import "./env";
import { runRenewalJob } from "../src/server/services/recurring";
import { getPool } from "../src/server/db/client";
runRenewalJob().then((r) => { console.log(`expired ${r.expired} offers, reminded ${r.reminded}, created ${r.sessionsCreated} sessions`); return getPool().end(); });
