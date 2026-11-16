"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { run, str, bool } from "./util";
import { authenticate, registerUser, requestPasswordReset, resetPassword, verifyEmail, ServiceError } from "@/server/services/identity";
import { createSession, destroySession, homeFor } from "@/server/auth/session";

export async function registerAction(f: FormData) {
  const kind = str(f, "kind") === "business" ? "business" : "worker";
  await run(async () => {
    const u = await registerUser({
      kind, fullName: str(f, "fullName"), email: str(f, "email"), password: str(f, "password"), phone: str(f, "phone") ?? "",
      city: str(f, "city") ?? "", postalPrefix: str(f, "postalPrefix") ?? "", businessName: str(f, "businessName") || undefined,
      businessKind: str(f, "businessKind") || undefined, acceptTerms: bool(f, "acceptTerms"),
    });
    await createSession(u.id, (await headers()).get("user-agent"));
    return kind === "worker" ? "/worker/onboarding?welcome=1" : "/business?welcome=1";
  }, `/register?type=${kind}`);
}

export async function loginAction(f: FormData) {
  const next = str(f, "next");
  await run(async () => {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const u = await authenticate(str(f, "email") ?? "", str(f, "password") ?? "", ip);
    await createSession(u.id, h.get("user-agent"));
    // only same-site relative paths are allowed as redirect targets
    return next && /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : homeFor(u);
  }, "/sign-in");
}

export async function logoutAction() { await destroySession(); redirect("/"); }

export async function forgotPasswordAction(f: FormData) {
  await requestPasswordReset(str(f, "email") ?? "").catch(() => {});
  redirect("/forgot-password?ok=" + encodeURIComponent("If an account exists for that email, a reset link is on its way."));
}

export async function resetPasswordAction(f: FormData) {
  const token = str(f, "token") ?? "";
  await run(async () => { await resetPassword(token, str(f, "password") ?? ""); return "/sign-in?ok=" + encodeURIComponent("Password updated. Please sign in."); }, `/reset-password?token=${encodeURIComponent(token)}`);
}

export async function verifyEmailAction(f: FormData) {
  const token = str(f, "token") ?? "";
  await run(async () => { await verifyEmail(token); return "/sign-in?ok=" + encodeURIComponent("Email verified. You can now sign in."); }, `/verify-email?token=${encodeURIComponent(token)}`);
}
export { ServiceError };
