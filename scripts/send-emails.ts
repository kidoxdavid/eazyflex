import "./env";
import { processOutbox } from "../src/server/email";
import { getPool } from "../src/server/db/client";
processOutbox(200).then((r) => { console.log(r.skipped ? "EMAIL_DRIVER is not smtp: nothing delivered" : `sent ${r.sent}, failed ${r.failed}`); return getPool().end(); });
