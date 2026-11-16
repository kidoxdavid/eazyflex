import net from "node:net";
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, files, messages } from "@/server/db/schema";
import { clamdInstream, scanBuffer, scanRequired, scanningEnabled, ScannerUnavailable } from "@/server/scanner";
import { authoriseDownload, saveUploads, uploadNotice } from "@/server/services/files";
import { S3Storage, _resetStorageForTests, getStorage } from "@/server/storage";
import { getConversation, sendMessage, startConversation } from "@/server/services/messaging";
import { saveOpportunity } from "@/server/services/opportunities";
import { getBusinessForUser } from "@/server/services/business";
import { applyToOpportunity } from "@/server/services/applications";
import { closeDb, freshDb, makeUser, ref } from "./helpers";

beforeAll(async () => { await freshDb(); process.env.STORAGE_DIR = "./.storage-test"; });
afterAll(closeDb);

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"; // the industry-standard harmless AV test string
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
const PDF_EICAR = Buffer.concat([PDF, Buffer.from("\n" + EICAR)]);

/** A fake clamd implementing the INSTREAM wire protocol: reads length-prefixed chunks until a zero-length chunk, then answers. */
function fakeClamd(opts: { hang?: boolean; reply?: string } = {}) {
  const seen: { chunks: number; bytes: number }[] = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0); let started = false; let payload: Buffer[] = []; let chunks = 0;
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d as Buffer]);
      if (!started) { const i = buf.indexOf(0); if (i < 0) return; if (buf.subarray(0, i).toString() !== "zINSTREAM") { sock.end("UNKNOWN COMMAND\0"); return; } started = true; buf = buf.subarray(i + 1); }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0); if (len === 0) { // end of stream
          seen.push({ chunks, bytes: Buffer.concat(payload).length }); if (opts.hang) return;
          const data = Buffer.concat(payload).toString("latin1"); sock.write((opts.reply ?? (data.includes(EICAR) ? "stream: Eicar-Test-Signature FOUND" : "stream: OK")) + "\0"); sock.end(); return; }
        if (buf.length < 4 + len) return; payload.push(buf.subarray(4, 4 + len)); chunks++; buf = buf.subarray(4 + len);
      }
    });
  });
  return { server, seen, listen: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as any).port))), close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("clamd INSTREAM client", () => {
  it("reports clean files, detects the EICAR signature, and streams large files in 64 KB chunks", async () => {
    const f = fakeClamd(); const port = await f.listen();
    expect(await clamdInstream(PDF, "127.0.0.1", port)).toEqual({ clean: true });
    expect(await clamdInstream(PDF_EICAR, "127.0.0.1", port)).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
    const big = Buffer.alloc(3 * 1024 * 1024 + 123, 7); expect((await clamdInstream(big, "127.0.0.1", port)).clean).toBe(true);
    expect(f.seen.at(-1)).toEqual({ chunks: Math.ceil(big.length / 65536), bytes: big.length }); await f.close();
  });
  it("fails closed: unreachable scanner, timeout, and unexpected replies all reject (never 'clean')", async () => {
    await expect(clamdInstream(PDF, "127.0.0.1", 1, 1000)).rejects.toBeInstanceOf(ScannerUnavailable);
    const hang = fakeClamd({ hang: true }); const p1 = await hang.listen(); await expect(clamdInstream(PDF, "127.0.0.1", p1, 300)).rejects.toThrow(/timed out/); await hang.close();
    const err = fakeClamd({ reply: "INSTREAM size limit exceeded. ERROR" }); const p2 = await err.listen(); await expect(clamdInstream(PDF, "127.0.0.1", p2)).rejects.toThrow(/unexpected scanner reply/); await err.close();
  });
});

describe("uploads with scanning policy", () => {
  let clamd: ReturnType<typeof fakeClamd>; let port = 0;
  beforeAll(async () => { clamd = fakeClamd(); port = await clamd.listen(); });
  afterAll(() => clamd.close());
  afterEach(() => { delete process.env.SCAN_DRIVER; delete process.env.SCAN_REQUIRED; delete process.env.CLAMD_PORT; });

  async function thread() {
    const { cat } = await ref(); const b = await makeUser("business"); const biz = (await getBusinessForUser(b.id))!.b; const w = await makeUser("worker");
    const o = await saveOpportunity(b.id, biz.id, { title: "Scanning test posting", description: "A description that is comfortably long enough to pass the minimum length rule for postings.", engagementType: "micro_task", categoryId: cat.id, arrangement: "remote", payType: "hourly", payMin: 30, payMax: 40 }, { publish: true });
    await applyToOpportunity(w.id, { opportunityId: o.id, proposal: "I have five years of relevant experience and can start right away." });
    return { b, w, cid: await startConversation(b.id, w.id) };
  }
  const on = () => { process.env.SCAN_DRIVER = "clamav"; process.env.CLAMD_PORT = String(port); process.env.SCAN_REQUIRED = "true"; };

  it("a malware-positive file is blocked, nothing is stored (including sibling files), the message is rolled back, and it is audited", async () => {
    on(); const { b, w, cid } = await thread();
    const before = (await db.select().from(files)).length, msgs = (await getConversation(b.id, cid)).msgs.length;
    await expect(sendMessage(w.id, cid, "here are my documents", [{ name: "good.pdf", data: PDF }, { name: "bad.pdf", data: PDF_EICAR }])).rejects.toThrow(/was blocked because it appears to contain malware/);
    expect((await db.select().from(files)).length).toBe(before); expect((await getConversation(b.id, cid)).msgs.length).toBe(msgs);
    const log = (await db.select().from(auditLogs).where(eq(auditLogs.actorId, w.id))).find((l) => l.action === "upload.blocked"); expect(JSON.stringify(log?.detail)).toMatch(/Eicar-Test-Signature/);
  });
  it("a clean file is stored with status 'clean' and can be downloaded by participants", async () => {
    on(); const { b, w, cid } = await thread(); await sendMessage(w.id, cid, "my resume", [{ name: "resume.pdf", data: PDF }]);
    const att = (await getConversation(b.id, cid)).msgs.at(-1)!.attachments[0]; const [row] = await db.select().from(files).where(eq(files.id, att.id));
    expect(row.scanStatus).toBe("clean"); await authoriseDownload({ id: b.id, kind: "business", adminRole: null }, att.id);
  });
  it("when scanning is required but the scanner is down, uploads are refused (fail closed) and nothing is stored", async () => {
    process.env.SCAN_DRIVER = "clamav"; process.env.CLAMD_PORT = "1"; process.env.SCAN_REQUIRED = "true"; const { w, cid } = await thread(); const before = (await db.select().from(files)).length;
    await expect(sendMessage(w.id, cid, "attachment attempt", [{ name: "a.pdf", data: PDF }])).rejects.toThrow(/couldn’t check your file for malware/); expect((await db.select().from(files)).length).toBe(before);
  });
  it("required but no scanner configured: uploads are unavailable; optional: stored as 'unscanned' (dev) and then refused at download if scanning becomes required", async () => {
    process.env.SCAN_REQUIRED = "true"; const { b, w, cid } = await thread(); await expect(sendMessage(w.id, cid, "no scanner here", [{ name: "a.pdf", data: PDF }])).rejects.toThrow(/temporarily unavailable/);
    process.env.SCAN_REQUIRED = "false"; await sendMessage(w.id, cid, "dev upload", [{ name: "dev.pdf", data: PDF }]);
    const att = (await getConversation(b.id, cid)).msgs.at(-1)!.attachments[0]; expect((await db.select().from(files).where(eq(files.id, att.id)))[0].scanStatus).toBe("unscanned");
    await authoriseDownload({ id: b.id, kind: "business", adminRole: null }, att.id);
    process.env.SCAN_REQUIRED = "true"; await expect(authoriseDownload({ id: b.id, kind: "business", adminRole: null }, att.id)).rejects.toThrow(/not found/i);
  });
  it("policy helpers and honest upload wording", () => {
    expect(scanningEnabled()).toBe(false); expect(scanRequired()).toBe(false); expect(uploadNotice()).toMatch(/not virus-scanned/);
    process.env.SCAN_REQUIRED = "true"; expect(uploadNotice()).toMatch(/unavailable/); on(); expect(uploadNotice()).toMatch(/scanned for malware before/);
  });
  it("scanBuffer reports unscanned when no driver is configured", async () => { expect(await scanBuffer(PDF)).toEqual({ clean: true, scanned: false }); });
  it("saveUploads rejects over-limit batches before scanning anything", async () => { await expect(saveUploads("00000000-0000-0000-0000-000000000000", Array.from({ length: 4 }, () => ({ name: "x.pdf", data: PDF })), { messageId: "m" })).rejects.toThrow(/at most 3/); });
  it("messages table untouched by blocked uploads", async () => { expect((await db.select().from(messages)).every((m) => m.body.length > 0)).toBe(true); });
});

describe("S3-compatible storage driver (against a fake S3 HTTP endpoint)", () => {
  const objects = new Map<string, { body: Buffer; sse?: string; auth?: string }>(); let server: http.Server; let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const key = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, "")); const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c)); req.on("end", () => {
        if (req.method === "PUT") { objects.set(key, { body: Buffer.concat(chunks), sse: String(req.headers["x-amz-server-side-encryption"] ?? ""), auth: String(req.headers.authorization ?? "") }); res.statusCode = 200; res.setHeader("ETag", '"x"'); res.end(); }
        else if (req.method === "GET") { const o = objects.get(key); if (!o) { res.statusCode = 404; res.setHeader("Content-Type", "application/xml"); res.end("<Error><Code>NoSuchKey</Code></Error>"); } else { res.statusCode = 200; res.setHeader("Content-Length", o.body.length); res.end(o.body); } }
        else if (req.method === "DELETE") { objects.delete(key); res.statusCode = 204; res.end(); } else { res.statusCode = 405; res.end(); }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); port = (server.address() as any).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const env = () => ({ S3_BUCKET: "private-bucket", S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: "AKIDEXAMPLE", S3_SECRET_ACCESS_KEY: "secretexample", S3_REGION: "ca-central-1" } as unknown as NodeJS.ProcessEnv);

  it("puts, gets and removes objects under the prefix with server-side encryption and signed requests", async () => {
    const s = new S3Storage(env()); const key = crypto.randomUUID(); const data = Buffer.alloc(3 * 1024 * 1024, 9);
    await s.put(key, data); const stored = objects.get(`private-bucket/uploads/${key}`)!; expect(stored.body.equals(data)).toBe(true); expect(stored.sse).toBe("AES256"); expect(stored.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect((await s.get(key)).equals(data)).toBe(true);
    await s.remove(key); expect(objects.has(`private-bucket/uploads/${key}`)).toBe(false); await expect(s.get(key)).rejects.toThrow();
  });
  it("only accepts server-generated UUID keys (no path traversal) and validates configuration", async () => {
    const s = new S3Storage(env()); for (const bad of ["../etc/passwd", "a/b", "short", ""]) await expect(s.put(bad, Buffer.from("x"))).rejects.toThrow(/bad storage key/);
    expect(() => new S3Storage({ ...env(), S3_BUCKET: "" })).toThrow(/S3_BUCKET/); expect(() => new S3Storage({ ...env(), S3_SSE: "nope" })).toThrow(/S3_SSE/);
  });
  it("is selectable by STORAGE_DRIVER and uploads flow through it end to end", async () => {
    Object.assign(process.env, env(), { STORAGE_DRIVER: "s3" }); _resetStorageForTests();
    const k = crypto.randomUUID(); await getStorage().put(k, PDF); expect((await getStorage().get(k)).equals(PDF)).toBe(true);
    process.env.STORAGE_DRIVER = "bogus"; _resetStorageForTests(); expect(() => getStorage()).toThrow(/Unknown STORAGE_DRIVER/);
    process.env.STORAGE_DRIVER = "local"; _resetStorageForTests();
    for (const k2 of ["S3_BUCKET", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION"]) delete process.env[k2];
  });
});
