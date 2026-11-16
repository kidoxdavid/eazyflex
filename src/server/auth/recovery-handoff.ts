import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "../crypto";

// Plain module (NOT a "use server" file): functions exported from "use server" files become client-callable endpoints.
const RC = "oh_recovery";
/** One-time hand-off of recovery codes to the next page via a short-lived, httpOnly, encrypted cookie (never put them in a URL). */
export const stashRecoveryCodes = async (codes: string[]) => (await cookies()).set(RC, encryptSecret(JSON.stringify(codes)), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/mfa", maxAge: 300 });
/** Read-only (pages can't modify cookies). The codes stay visible until the user clicks "continue" or 5 minutes pass. */
export async function peekRecoveryCodes(): Promise<string[] | null> {
  const v = (await cookies()).get(RC)?.value; if (!v) return null;
  try { return JSON.parse(decryptSecret(v)); } catch { return null; }
}
export const clearRecoveryCodes = async () => (await cookies()).delete({ name: RC, path: "/mfa" });
