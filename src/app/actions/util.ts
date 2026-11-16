import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ServiceError } from "@/server/services/identity";

export function withParams(path: string, params: Record<string, string>) {
  const [p, qs = ""] = path.split("?");
  const sp = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}

export function friendlyError(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  if (e instanceof ZodError) { const i = e.issues[0]; return (i.path.length ? `${String(i.path[i.path.length - 1])}: ` : "") + i.message; }
  if (e && typeof e === "object" && "digest" in e && String((e as any).digest).startsWith("NEXT_REDIRECT")) throw e;
  void import("@/server/monitoring").then((m) => m.captureException(e, { route: "server-action" }));
  return "Something went wrong. Please try again.";
}

/** Runs a mutation then redirects with ?ok= or ?error= (works without client JS). */
export async function run(fn: () => Promise<string | void>, to: string, ok?: string): Promise<never> {
  let params: Record<string, string> = {};
  let dest = to;
  try { const r = await fn(); if (typeof r === "string" && r.startsWith("/")) dest = r;
    if (ok) params = { ok }; }
  catch (e) { params = { error: friendlyError(e) }; }
  redirect(withParams(dest, params));
}

export const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : undefined; };
export const strs = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
export const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
export const toMinutes = (t?: string) => { const m = t?.match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Parse "w_{day}_{slot}_start|end" time inputs (2 slots/day) into windows. */
export function parseWindows(f: FormData, prefix = "w") {
  const out: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (let d = 0; d < 7; d++) for (let s = 0; s < 2; s++) {
    const a = toMinutes(str(f, `${prefix}_${d}_${s}_start`)), b = toMinutes(str(f, `${prefix}_${d}_${s}_end`));
    if (a !== null && b !== null) out.push({ weekday: d, startMinute: a, endMinute: b === 0 ? 1440 : b });
    else if ((a === null) !== (b === null) && (str(f, `${prefix}_${d}_${s}_start`) || str(f, `${prefix}_${d}_${s}_end`))) throw new ServiceError("Enter both a start and an end time for each availability window");
  }
  return out;
}

/** Optional post-save destination for multi-step flows. Only same-site worker paths are honoured. */
export const ret = (f: FormData, fallback: string) => { const v = str(f, "returnTo"); return v && /^\/worker\/[\w\-/?=&.]*$/.test(v) ? v : fallback; };
export const failTo = (f: FormData, fallback: string) => { const v = str(f, "failTo"); return v && /^\/worker\/[\w\-/?=&.]*$/.test(v) ? v : fallback; };

/** Reads uploaded files from a form. Empty file inputs (size 0, no name) are ignored. */
export async function readUploads(f: FormData, field = "files") {
  const out: { name: string; data: Buffer }[] = [];
  for (const v of f.getAll(field)) if (typeof v !== "string" && v.size > 0) out.push({ name: v.name, data: Buffer.from(await v.arrayBuffer()) });
  return out;
}
