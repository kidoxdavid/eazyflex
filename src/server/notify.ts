import { db, type Db } from "./db/client";
import { notifications } from "./db/schema";
type Tx = Pick<Db, "insert">;
export const notify = (userId: string, type: string, title: string, body: string, href: string, tx: Tx = db) =>
  tx.insert(notifications).values({ userId, type, title, body, href });
