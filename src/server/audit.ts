import { db, type Db } from "./db/client";
import { auditLogs } from "./db/schema";

type Tx = Pick<Db, "insert">;
export async function audit(
  actorId: string | null, action: string, entityType: string, entityId?: string | null,
  detail?: Record<string, unknown>, tx: Tx = db,
) {
  await tx.insert(auditLogs).values({ actorId, action, entityType, entityId: entityId ?? null, detail: detail ?? null });
}
