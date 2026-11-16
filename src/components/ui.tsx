import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const btnBase = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50";
const variants = {
  primary: "bg-primary text-primary-fg shadow-[0_14px_28px_-16px_rgba(15,43,33,.8)] hover:bg-[#16402f]",
  secondary: "bg-secondary text-secondary-fg hover:bg-[#d3e6c6]",
  accent: "bg-accent text-accent-fg shadow-[0_14px_30px_-14px_rgba(163,240,122,.9)] hover:bg-[#b4f48f]",
  outline: "border-2 border-primary/80 bg-transparent text-primary hover:bg-secondary/60",
  danger: "bg-error text-white hover:bg-[#8f1f19]",
  ghost: "text-text hover:bg-secondary/60",
  glass: "glass-dark text-white hover:bg-white/15",
};
type Variant = keyof typeof variants;

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...p} className={cx(btnBase, variants[variant], className)} />;
}
export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cx(btnBase, variants[variant], className)} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cx("rounded-[var(--radius-card)] border border-border bg-surface/90 p-5 shadow-[0_1px_2px_rgba(20,32,27,.04),0_22px_44px_-30px_rgba(20,32,27,.30)]", className)} />;
}

const tones = { neutral: "bg-secondary text-secondary-fg", success: "bg-[#dff3e8] text-success", warning: "bg-[#fbebd3] text-warning", error: "bg-[#fbe3e1] text-error", info: "bg-[#dcebf6] text-info", outline: "border border-border text-muted" };
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs font-medium text-error">{error}</p>}
    </div>
  );
}
const inputCls = "block w-full min-h-11 rounded-2xl border border-[#d6cdb9] bg-surface px-4 py-2 text-base text-text placeholder:text-muted/70";
export const Input = (p: ComponentProps<"input">) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: ComponentProps<"textarea">) => <textarea rows={4} {...p} className={cx(inputCls, "py-2.5", p.className)} />;
export const Select = (p: ComponentProps<"select">) => <select {...p} className={cx(inputCls, p.className)} />;

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return error
    ? <div role="alert" className="mb-5 rounded-xl border border-error/30 bg-[#fbe3e1] px-4 py-3 text-sm font-medium text-error">{error}</div>
    : <div role="status" className="mb-5 rounded-xl border border-success/30 bg-[#dff3e8] px-4 py-3 text-sm font-medium text-success">{ok}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface/60 px-6 py-12 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="on-dark mb-8 flex flex-wrap items-end justify-between gap-3 text-white">
      <div><h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>{subtitle && <p className="mt-1 text-white/80">{subtitle}</p>}</div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <Card><p className="text-sm text-muted">{label}</p><p className="mt-1 font-display text-3xl font-extrabold tracking-tight">{value}</p>{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</Card>;
}

export const DEMO_BADGE = <Badge tone="warning">Demo data</Badge>;

/** Match score as a ring. Always shown beside a plain-language reason; the number is also in the accessible name. */
export function MatchRing({ score, size = 52, tone = "good" }: { score: number; size?: number; tone?: "good" | "look" }) {
  const d = (138.2 * Math.max(0, Math.min(100, score))) / 100;
  const color = tone === "good" ? "#2e9e4f" : "#d98a00";
  return (
    <svg className="match-ring shrink-0" width={size} height={size} viewBox="0 0 54 54" role="img" aria-label={`Match ${score} out of 100`}>
      <circle cx="27" cy="27" r="22" fill="none" stroke="rgba(20,32,27,.12)" strokeWidth="6" />
      <circle cx="27" cy="27" r="22" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${d.toFixed(1)} 138.2`} transform="rotate(-90 27 27)" />
      <text x="27" y="32" textAnchor="middle" fontWeight="800" fontSize="15" fill="#14201b">{score}</text>
    </svg>
  );
}
