import { Logo } from "@/components/site";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary/60 to-background">
      <div className="mx-auto max-w-md px-4 py-8"><Logo />
        <main id="main" tabIndex={-1} className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">{children}</main></div>
    </div>
  );
}
