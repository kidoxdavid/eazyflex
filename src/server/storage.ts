import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Private object storage. Drivers: "local" (dev / single host, STORAGE_DIR) and "s3" (any S3-compatible service). Keys are server-generated UUIDs only. */
export interface Storage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void>; }
const KEY = /^[a-f0-9-]{36}$/;
const checkKey = (key: string) => { if (!KEY.test(key)) throw new Error("bad storage key"); return key; };

class LocalStorage implements Storage {
  private get root() { return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./.storage"); } // read per call so configuration changes apply
  private p(key: string) { return path.join(this.root, checkKey(key)); }
  async put(key: string, data: Buffer) { await fs.mkdir(this.root, { recursive: true }); await fs.writeFile(this.p(key), data, { mode: 0o600 }); }
  async get(key: string) { return fs.readFile(this.p(key)); }
  async remove(key: string) { await fs.rm(this.p(key), { force: true }); }
}

/** Env: S3_BUCKET (required), S3_REGION, S3_ENDPOINT (non-AWS services / local), S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (else the SDK's default credential chain), S3_FORCE_PATH_STYLE=true, S3_SSE=AES256|aws:kms, S3_KMS_KEY_ID, S3_PREFIX. */
export class S3Storage implements Storage {
  private client: S3Client; private bucket: string; private prefix: string;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    this.bucket = env.S3_BUCKET; this.prefix = (env.S3_PREFIX ?? "uploads/").replace(/^\/+/, "");
    this.sse = env.S3_SSE === "aws:kms" ? "aws:kms" : env.S3_SSE === "AES256" || !env.S3_SSE ? "AES256" : (() => { throw new Error("S3_SSE must be AES256 or aws:kms"); })();
    this.kms = env.S3_KMS_KEY_ID;
    this.client = new S3Client({
      region: env.S3_REGION ?? "ca-central-1", endpoint: env.S3_ENDPOINT || undefined, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined,
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3,
    });
  }
  private sse: "AES256" | "aws:kms"; private kms?: string;
  private k(key: string) { return this.prefix + checkKey(key); }
  async put(key: string, data: Buffer) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: data, ContentType: "application/octet-stream", ServerSideEncryption: this.sse, ...(this.sse === "aws:kms" && this.kms ? { SSEKMSKeyId: this.kms } : {}) })); }
  async get(key: string) { const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) })); return Buffer.from(await r.Body!.transformToByteArray()); }
  async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) })); }
}

let cached: { driver: string; impl: Storage } | null = null;
export function getStorage(): Storage {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (!cached || cached.driver !== driver) {
    if (driver === "local" && process.env.NODE_ENV === "production" && !process.env.STORAGE_DIR) throw new Error("STORAGE_DIR (or STORAGE_DRIVER=s3) must be configured in production");
    cached = { driver, impl: driver === "s3" ? new S3Storage() : driver === "local" ? new LocalStorage() : (() => { throw new Error(`Unknown STORAGE_DRIVER "${driver}"`); })() };
  }
  return cached.impl;
}
export const storage: Storage = { put: (k, d) => getStorage().put(k, d), get: (k) => getStorage().get(k), remove: (k) => getStorage().remove(k) };
export const _resetStorageForTests = () => { cached = null; };
