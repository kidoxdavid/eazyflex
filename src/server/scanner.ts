import net from "node:net";

/**
 * Malware scanning of uploads via ClamAV's clamd INSTREAM protocol (SCAN_DRIVER=clamav, CLAMD_HOST, CLAMD_PORT=3310).
 * FAIL CLOSED: if scanning is required and the scanner is unreachable, slow, or answers anything unexpected, the upload is refused —
 * we never store an unscanned file because the scanner was down. SCAN_REQUIRED defaults to true in production.
 */
export type ScanResult = { clean: boolean; scanned: boolean; signature?: string };
export class ScannerUnavailable extends Error { constructor(m: string) { super(m); this.name = "ScannerUnavailable"; } }

export const scanningEnabled = () => (process.env.SCAN_DRIVER ?? "none") === "clamav";
export const scanRequired = () => (process.env.SCAN_REQUIRED ? process.env.SCAN_REQUIRED === "true" : process.env.NODE_ENV === "production");

const CHUNK = 64 * 1024;
export function clamdInstream(data: Buffer, host: string, port: number, timeoutMs = 20_000): Promise<{ clean: boolean; signature?: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }); let out = ""; let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); sock.destroy(); fn(); } };
    const timer = setTimeout(() => finish(() => reject(new ScannerUnavailable("scan timed out"))), timeoutMs);
    sock.on("error", (e) => finish(() => reject(new ScannerUnavailable(`scanner connection failed: ${e.message}`))));
    sock.on("data", (d) => { out += d.toString("utf8"); if (out.includes("\0")) finish(() => parse(out.split("\0")[0])); });
    sock.on("end", () => finish(() => (out ? parse(out) : reject(new ScannerUnavailable("scanner closed the connection")))));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < data.length; i += CHUNK) { const c = data.subarray(i, i + CHUNK); const len = Buffer.alloc(4); len.writeUInt32BE(c.length); sock.write(len); sock.write(c); }
      sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
    function parse(reply: string) {
      const r = reply.trim();
      if (/^stream: OK$/.test(r)) return resolve({ clean: true });
      const m = r.match(/^stream: (.+) FOUND$/); if (m) return resolve({ clean: false, signature: m[1] });
      reject(new ScannerUnavailable(`unexpected scanner reply: ${r.slice(0, 80)}`)); // includes "size limit exceeded ... ERROR"
    }
  });
}

export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  if (!scanningEnabled()) return { clean: true, scanned: false };
  const r = await clamdInstream(data, process.env.CLAMD_HOST ?? "127.0.0.1", Number(process.env.CLAMD_PORT ?? 3310), Number(process.env.CLAMD_TIMEOUT_MS ?? 20_000));
  return { clean: r.clean, scanned: true, signature: r.signature };
}
