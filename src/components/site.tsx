import Link from "next/link";
import { brand } from "@/lib/brand";
import { getCurrentUser, homeFor } from "@/server/auth/session";
import { LinkButton } from "./ui";
import { logoutAction } from "@/app/actions/auth";

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2 font-display text-xl font-semibold ${light ? "text-white" : "text-primary"}`} aria-label={`${brand.name} home`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="currentColor" opacity=".12" /><path d="M14 5v9l6 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="14" cy="14" r="2" fill="#e6a66a" /></svg>
      {brand.name}
    </Link>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {brand.nav.map((n) => <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary/60">{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <LinkButton href={homeFor(user)} variant="secondary">Dashboard</LinkButton>
              <form action={logoutAction}><button className="min-h-11 rounded-xl px-3 text-sm font-medium hover:bg-secondary/60">Sign out</button></form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-secondary/60 sm:inline-flex">Sign in</Link>
              <LinkButton href="/register">Get started</LinkButton>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-t border-border px-3 py-1.5 lg:hidden">
        {brand.nav.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary/60">{n.label}</Link>)}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const col = (title: string, links: [string, string][]) => (
    <div><h2 className="font-sans text-sm font-semibold text-accent">{title}</h2><ul className="mt-3 space-y-2 text-sm">{links.map(([l, h]) => <li key={h + l}><Link className="text-white/85 hover:text-white" href={h}>{l}</Link></li>)}</ul></div>
  );
  return (
    <footer className="mt-20 bg-primary text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-4">
        <div><Logo light /><p className="mt-3 max-w-xs text-sm text-white/80">{brand.tagline}</p><p className="mt-3 text-xs text-white/60">Launching in {brand.launchCity}, {brand.launchRegion}.</p></div>
        {col("For workers", [["Find work", "/find-work"], ["Browse opportunities", "/opportunities"], ["Create an account", "/register?type=worker"]])}
        {col("For businesses", [["Hire talent", "/hire-talent"], ["Post work", "/register?type=business"], ["How it works", "/how-it-works"]])}
        {col("Company", [["About", "/about"], ["Trust & safety", "/about#trust"], ["Terms", "/terms"], ["Privacy", "/privacy"]])}
      </div>
      <div className="border-t border-white/15 px-4 py-4 text-center text-xs text-white/60">© {new Date().getFullYear()} {brand.name}. {brand.name} is a marketplace platform and does not provide legal, tax or employment advice.</div>
    </footer>
  );
}

export async function PublicShell({ children }: { children: React.ReactNode }) {
  return <><SiteHeader /><main id="main">{children}</main><SiteFooter /></>;
}
