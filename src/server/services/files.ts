import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assignmentSubmissions, assignments, businessMembers, conversations, files, messageReports, messages } from "../db/schema";
import { storage } from "../storage";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { ServiceError } from "./identity";
import { can, type AdminRole } from "../rbac";

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 3;

const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);
/** Allow-list by extension, each verified against content ("magic bytes") — the client-supplied MIME type is ignored. */
const TYPES: Record<string, { mime: string; check: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]) },
  png: { mime: "image/png", check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: { mime: "image/jpeg", check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  csv: { mime: "text/csv", check: (b) => !b.includes(0) },
  txt: { mime: "text/plain", check: (b) => !b.includes(0) },
};
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

export const safeName = (n: string) => n.replace(/[\\/\0\r\n"]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

export type Upload = { name: string; data: Buffer };
export function validateUpload(u: Upload) {
  const ext = u.name.split(".").pop()?.toLowerCase() ?? "";
  const t = TYPES[ext];
  if (!t) throw new ServiceError(`“${safeName(u.name)}”: this file type isn’t allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  if (u.data.length === 0) throw new ServiceError(`“${safeName(u.name)}” is empty`);
  if (u.data.length > MAX_BYTES) throw new ServiceError(`“${safeName(u.name)}” is larger than 10 MB`);
  if (!t.check(u.data)) throw new ServiceError(`“${safeName(u.name)}” doesn’t look like a real .${ext} file`);
  return { mime: t.mime };
}

/** Validate everything first (so nothing is stored if any file is bad), then store and record. */
export async function saveUploads(uploaderId: string, uploads: Upload[], ctx: { messageId: string } | { submissionId: string }) {
  if (uploads.length > MAX_FILES) throw new ServiceError(`Attach at most ${MAX_FILES} files`);
  const checked = uploads.map((u) => ({ u, ...validateUpload(u) }));
  if (checked.length && !(await rateLimit(`upload:${uploaderId}`, 30, 3600))) throw new ServiceError("Too many uploads. Try again later.", "rate_limited");
  for (const c of checked) {
    const key = randomUUID();
    await storage.put(key, c.u.data);
    try {
      await db.insert(files).values({ uploaderId, storageKey: key, originalName: safeName(c.u.name), mime: c.mime, sizeBytes: c.u.data.length, sha256: createHash("sha256").update(c.u.data).digest("hex"), ...ctx });
    } catch (e) { await storage.remove(key); throw e; }
  }
}

export async function attachmentsFor(opts: { messageIds?: string[]; submissionIds?: string[] }) {
  const out = [];
  if (opts.messageIds?.length) out.push(...await db.select({ id: files.id, name: files.originalName, size: files.sizeBytes, messageId: files.messageId, submissionId: files.submissionId }).from(files).where(inArray(files.messageId, opts.messageIds)));
  if (opts.submissionIds?.length) out.push(...await db.select({ id: files.id, name: files.originalName, size: files.sizeBytes, messageId: files.messageId, submissionId: files.submissionId }).from(files).where(inArray(files.submissionId, opts.submissionIds)));
  return out;
}

/** Authorise a download. Participants only; admins only for a message with an open report, and that access is audited. */
export async function authoriseDownload(user: { id: string; kind: string; adminRole: string | null }, fileId: string) {
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.scanStatus === "infected") throw new ServiceError("File not found", "not_found");
  let ok = false;
  if (f.messageId) {
    const [m] = await db.select({ c: conversations }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(eq(messages.id, f.messageId));
    if (m) {
      if (user.kind === "worker") ok = m.c.workerId === user.id;
      else if (user.kind === "business") ok = !!(await db.select().from(businessMembers).where(and(eq(businessMembers.userId, user.id), eq(businessMembers.businessId, m.c.businessId))))[0];
      else if (user.kind === "admin" && can(user.adminRole as AdminRole, "reports.review")) {
        const [rep] = await db.select().from(messageReports).where(and(eq(messageReports.messageId, f.messageId), eq(messageReports.status, "open"))).limit(1);
        if (rep) { ok = true; await audit(user.id, "file.accessed_by_admin", "file", f.id, { messageId: f.messageId }); }
      }
    }
  } else if (f.submissionId) {
    const [s] = await db.select({ a: assignments }).from(assignmentSubmissions).innerJoin(assignments, eq(assignments.id, assignmentSubmissions.assignmentId)).where(eq(assignmentSubmissions.id, f.submissionId));
    if (s) {
      if (user.kind === "worker") ok = s.a.workerId === user.id;
      else if (user.kind === "business") ok = !!(await db.select().from(businessMembers).where(and(eq(businessMembers.userId, user.id), eq(businessMembers.businessId, s.a.businessId))))[0];
    }
  }
  if (!ok) throw new ServiceError("File not found", "not_found");
  return f;
}
export async function readFile(storageKey: string) { return storage.get(storageKey); }
