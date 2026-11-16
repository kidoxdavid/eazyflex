import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, newSecret, otpauthUri, stepOf, totp, verifyTotp } from "@/server/auth/totp";
import { decryptSecret, encryptSecret } from "@/server/crypto";

// RFC 4226 Appendix D test vectors (secret "12345678901234567890")
const SECRET = Buffer.from("12345678901234567890");
describe("HOTP / TOTP against the RFCs' published vectors", () => {
  it("matches RFC 4226 Appendix D", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((e, i) => expect(hotp(SECRET, i)).toBe(e));
  });
  it("matches RFC 6238 Appendix B (SHA-1, 8 digits)", () => {
    const b32 = base32Encode(SECRET);
    const vec: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
    for (const [t, code] of vec) expect(totp(b32, t * 1000, 8)).toBe(code);
  });
  it("base32 round-trips", () => { for (let n = 1; n < 40; n++) { const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255)); expect(base32Decode(base32Encode(b))).toEqual(b); } expect(() => base32Decode("1!")).toThrow(); });
});
describe("verification", () => {
  const s = newSecret(); const now = 1_700_000_000_000;
  it("accepts the current code and ±1 step, rejects others, malformed input and returns the matched step", () => {
    expect(verifyTotp(s, totp(s, now), now)).toBe(stepOf(now));
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(stepOf(now) - 1);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(stepOf(now) + 1);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "123 456"]) expect(verifyTotp(s, bad, now)).toBeNull();
  });
  it("secrets are 160 bits and the otpauth URI is well formed", () => {
    expect(base32Decode(newSecret()).length).toBe(20);
    expect(otpauthUri("a@b.test", s, "Openhour")).toMatch(/^otpauth:\/\/totp\/Openhour:a%40b\.test\?secret=[A-Z2-7]+&issuer=Openhour/);
  });
});
describe("secret encryption", () => {
  it("round-trips, uses a fresh IV each time, and detects tampering", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP"), b = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b); expect(decryptSecret(a)).toBe("JBSWY3DPEHPK3PXP"); expect(a).not.toContain("JBSWY3DP");
    const parts = a.split("."); parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
