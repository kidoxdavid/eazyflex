import { getAreas, getCategories } from "@/server/services/catalog";
import { Button, Select, Input } from "./ui";

export async function SearchBar({ defaults = {} as Record<string, string | undefined> }) {
  const [cats, areas] = await Promise.all([getCategories(), getAreas()]);
  return (
    <form action="/opportunities" method="get" role="search" className="grid gap-3 rounded-[1.75rem] border border-white/60 bg-surface/95 p-4 shadow-[0_30px_60px_-30px_rgba(7,9,13,.7)] md:grid-cols-[2fr_1fr_1.3fr_1.3fr_auto]">
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">What kind of work?</span><Input name="q" defaultValue={defaults.q} placeholder="e.g. bookkeeping, data entry" /></label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Remote or local?</span>
        <Select name="arrangement" defaultValue={defaults.arrangement ?? ""}><option value="">Any</option><option value="remote">Remote</option><option value="local">Local (on-site)</option><option value="hybrid">Hybrid</option></Select></label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Location</span>
        <Select name="area" defaultValue={defaults.area ?? ""}><option value="">Anywhere</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Category</span>
        <Select name="category" defaultValue={defaults.category ?? ""}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
      <div className="flex items-end"><Button type="submit" className="w-full">Search</Button></div>
    </form>
  );
}
