import Link from "next/link";
import { Logo } from "@/components/site";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div aria-hidden="true" className="band pointer-events-none absolute inset-x-0 top-0 h-96" />
      <div className="relative mx-auto max-w-md px-4 py-8"><Logo light />
        <main id="main" tabIndex={-1} className="mt-8 rounded-[1.75rem] border border-border bg-surface p-6 shadow-[0_30px_60px_-30px_rgba(7,9,13,.55)] sm:p-8">{children}</main>
        <p className="mt-5 text-center text-sm text-muted">Stuck? <Link href="/help" className="font-bold text-primary underline">Talk to a person</Link></p></div>
    </div>
  );
}
