import Link from "next/link";
import { brand } from "@/lib/brand";
import { getCurrentUser, homeFor } from "@/server/auth/session";
import { LinkButton } from "./ui";
import { logoutAction } from "@/app/actions/auth";

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link href="/" className={`flex min-h-11 items-center gap-2 text-xl font-extrabold tracking-tight ${light ? "text-white" : "text-primary"}`} aria-label={`${brand.name} home`}>
      <svg width="28" height="28" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke={light ? "#a3f07a" : "currentColor"} strokeWidth="3" /><path d="M17 9v8.5l5 3" fill="none" stroke={light ? "#a3f07a" : "currentColor"} strokeWidth="3" strokeLinecap="round" /></svg>
      {brand.name}
    </Link>
  );
}

const navLink = "min-h-11 items-center whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="on-dark sticky top-3 z-40 mx-auto w-full max-w-6xl px-3">
      <div className="glass-dark flex items-center justify-between gap-3 rounded-full py-2 pl-5 pr-2 shadow-[0_20px_50px_-24px_rgba(0,0,0,.7)]">
        <Logo light />
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          {brand.nav.map((n) => <Link key={n.href} href={n.href} className={`inline-flex ${navLink}`}>{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-1.5">
          {user ? (
            <>
              <LinkButton href={homeFor(user)} variant="accent">Dashboard</LinkButton>
              <form action={logoutAction}><button className={`inline-flex ${navLink}`}>Sign out</button></form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={`hidden sm:inline-flex ${navLink}`}>Sign in</Link>
              <LinkButton href="/register" variant="accent" className="whitespace-nowrap">Get started</LinkButton>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Main (mobile)" className="mt-2 flex gap-1 overflow-x-auto rounded-full border border-white/15 bg-[#14382c] px-2 py-1 shadow-[0_16px_36px_-20px_rgba(0,0,0,.7)] lg:hidden">
        {brand.nav.map((n) => <Link key={n.href} href={n.href} className={`inline-flex ${navLink}`}>{n.label}</Link>)}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const col = (title: string, links: [string, string][]) => (
    <div><h2 className="font-sans text-sm font-bold text-accent">{title}</h2><ul className="mt-3 space-y-2 text-sm">{links.map(([l, h]) => <li key={h + l}><Link className="text-white/85 hover:text-white" href={h}>{l}</Link></li>)}</ul></div>
  );
  return (
    <footer className="on-dark mt-20 bg-gradient-to-b from-[#0f2a22] to-[#07090d] text-white">
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
  // A dusk band sits behind the floating header on every public page; the home hero extends it.
  return (
    <div className="relative">
      <div aria-hidden="true" className="band-sm pointer-events-none absolute inset-x-0 top-0 -z-10 h-32" />
      <SiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
