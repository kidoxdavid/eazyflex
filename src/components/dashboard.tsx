import Link from "next/link";
import { Logo } from "./site";
import { logoutAction } from "@/app/actions/auth";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export type NavItem = { label: string; href: string };

export async function DashboardShell({ nav, user, area, children }: { nav: NavItem[]; user: { id: string; fullName: string; emailVerifiedAt: Date | null }; area: string; children: React.ReactNode }) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="on-dark bg-gradient-to-b from-[#07090d] via-[#0f2a22] to-[#14382c] text-white lg:min-h-screen">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-6"><Logo light /><span className="text-xs font-bold uppercase tracking-wider text-accent lg:mt-1 lg:block">{area}</span></div>
        <nav aria-label={`${area} navigation`} className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((i) => <Link key={i.href} href={i.href} className="whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white">{i.label}</Link>)}
        </nav>
        <div className="hidden px-5 py-4 text-sm lg:block">
          <p className="font-bold">{user.fullName}</p>
          <form action={logoutAction}><button className="mt-1 text-white/75 underline hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <div className="relative overflow-x-clip">
        <div aria-hidden="true" className="band pointer-events-none absolute inset-x-0 top-0 h-80" />
        <div className="on-dark relative flex items-center justify-end gap-4 px-4 py-3 text-sm text-white/85">
          <Link href="/" className="underline">Public site</Link>
          <span aria-live="polite">{n > 0 ? <strong>{n} unread notification{n > 1 ? "s" : ""}</strong> : "No new notifications"}</span>
          <form action={logoutAction} className="lg:hidden"><button className="underline">Sign out</button></form>
        </div>
        {!user.emailVerifiedAt && <div role="status" className="relative mx-4 rounded-2xl bg-[#fff1d6] px-4 py-2 text-sm text-warning">Your email is not verified yet. Open the link we sent you to verify it — you cannot apply or be discoverable until then.</div>}
        <main id="main" tabIndex={-1} className="relative mx-auto max-w-5xl px-4 py-8">{children}</main>
      </div>
    </div>
  );
}
