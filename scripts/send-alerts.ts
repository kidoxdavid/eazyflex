import "./env";
import { runSavedSearchAlerts } from "../src/server/services/saved-searches";
import { getPool } from "../src/server/db/client";
runSavedSearchAlerts().then((r) => { console.log(`checked ${r.searches} saved searches, notified ${r.notified}`); return getPool().end(); });
