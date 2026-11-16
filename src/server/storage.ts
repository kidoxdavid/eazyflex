import fs from "node:fs/promises";
import path from "node:path";

/** Private object storage abstraction. Only the local-filesystem driver exists; an S3-compatible driver must be added for production. */
export interface Storage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void>; }

class LocalStorage implements Storage {
  private get root() { return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./.storage"); } // read per call so configuration changes apply
  private p(key: string) { if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("bad storage key"); return path.join(this.root, key); }
  async put(key: string, data: Buffer) { await fs.mkdir(this.root, { recursive: true }); await fs.writeFile(this.p(key), data, { mode: 0o600 }); }
  async get(key: string) { return fs.readFile(this.p(key)); }
  async remove(key: string) { await fs.rm(this.p(key), { force: true }); }
}
export const storage: Storage = new LocalStorage();
