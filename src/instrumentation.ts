// Next.js instrumentation hook: runs once per server start; onRequestError sees every unhandled error in rendering, route handlers and server actions.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./server/monitoring");
  log.info("server starting", { release: process.env.APP_RELEASE ?? process.env.GIT_SHA ?? "dev", sentry: !!process.env.SENTRY_DSN, mfa: process.env.MFA_ENFORCEMENT ?? "default" });
  if (process.env.NODE_ENV === "production" && !process.env.APP_SECRET) log.error("APP_SECRET is not set: admin two-factor authentication will fail");
}

export async function onRequestError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routerKind: string; routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("./server/monitoring");
  const rid = request.headers["x-request-id"];
  await captureException(err, { requestId: Array.isArray(rid) ? rid[0] : rid, route: context.routePath, method: request.method, extra: { routeType: context.routeType, routerKind: context.routerKind } });
}
