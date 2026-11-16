import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) — what Google Authenticator, Authy, 1Password etc. implement. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/[\s=-]/g, "").toUpperCase()) { const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error("bad base32"); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));
export const stepOf = (ms: number, period = 30) => Math.floor(ms / 1000 / period);

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest(); const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}
export const totp = (secretB32: string, ms = Date.now(), digits = 6) => hotp(base32Decode(secretB32), stepOf(ms), digits);

/** Returns the matching time step (so the caller can reject replays), or null. Accepts ±1 step for clock drift. */
export function verifyTotp(secretB32: string, code: string, ms = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32); const cur = stepOf(ms);
  let hit: number | null = null;
  for (let d = -window; d <= window; d++) { // constant work regardless of where (or whether) it matches
    const exp = Buffer.from(hotp(secret, cur + d)); const got = Buffer.from(code);
    if (exp.length === got.length && timingSafeEqual(exp, got) && hit === null) hit = cur + d;
  }
  return hit;
}
export const otpauthUri = (account: string, secretB32: string, issuer: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
