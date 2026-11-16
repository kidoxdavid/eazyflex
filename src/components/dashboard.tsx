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
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="border-b border-border bg-surface lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-6"><Logo /><span className="text-xs font-semibold uppercase tracking-wide text-muted lg:mt-1 lg:block">{area}</span></div>
        <nav aria-label={`${area} navigation`} className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((i) => <Link key={i.href} href={i.href} className="whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-secondary/70">{i.label}</Link>)}
        </nav>
        <div className="hidden px-4 py-4 text-sm lg:block">
          <p className="font-semibold">{user.fullName}</p>
          <form action={logoutAction}><button className="mt-1 text-muted underline">Sign out</button></form>
        </div>
      </aside>
      <div>
        <div className="flex items-center justify-end gap-4 border-b border-border bg-surface/70 px-4 py-2 text-sm">
          <Link href="/" className="underline">Public site</Link>
          <span aria-live="polite">{n > 0 ? <strong>{n} unread notification{n > 1 ? "s" : ""}</strong> : "No new notifications"}</span>
          <form action={logoutAction} className="lg:hidden"><button className="underline">Sign out</button></form>
        </div>
        {!user.emailVerifiedAt && <div role="status" className="bg-[#fbebd3] px-4 py-2 text-sm text-warning">Your email is not verified yet. Open the link we sent you to verify it — you cannot apply or be discoverable until then.</div>}
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </div>
    </div>
  );
}
