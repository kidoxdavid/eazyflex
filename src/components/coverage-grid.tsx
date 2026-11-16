import type { Win } from "@/server/coverage/engine";

type S = { id: string; workerId: string; workerName: string; weekday: number; startMinute: number; endMinute: number; status: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const PALETTE = ["#1f5f8b", "#9a5b00", "#1f7a4d", "#7b3f98", "#b3261e", "#00796b", "#5d4037", "#37474f"];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const colourFor = (workerIds: string[], id: string) => PALETTE[workerIds.indexOf(id) % PALETTE.length];

/**
 * Weekly coverage picture. Required hours are dashed outlines, uncovered required time is hatched red, confirmed slices are solid
 * blocks, proposed slices are lighter with a dashed border. Every block carries a text label, and a table below
 * gives the same information, so nothing relies on colour alone.
 */
export function CoverageGrid({ required, slices, gaps, overlaps = [] }: { required: Win[]; slices: S[]; gaps: Win[]; overlaps?: Win[] }) {
  const active = slices.filter((s) => s.status === "confirmed" || s.status === "proposed");
  const all = [...required, ...active];
  const from = Math.max(0, Math.floor(Math.min(...all.map((w) => w.startMinute), 540) / 60) * 60 - 60);
  const to = Math.min(1440, Math.ceil(Math.max(...all.map((w) => w.endMinute), 900) / 60) * 60 + 60);
  const H = 360, y = (m: number) => ((m - from) / (to - from)) * H;
  const workerIds = [...new Set(active.map((s) => s.workerId))];
  const hours = Array.from({ length: Math.floor((to - from) / 60) + 1 }, (_, i) => from + i * 60);
  return (
    <div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Weekly coverage chart (scrollable)"><div className="flex min-w-[640px] gap-1 pb-4" role="img" aria-label="Weekly coverage chart. A table with the same information follows.">
        <div className="relative w-10 shrink-0" style={{ height: H + 24, paddingTop: 24 }}>{hours.map((h) => <span key={h} className="absolute right-1 text-[10px] text-muted" style={{ top: 24 + y(h) - 6 }}>{hm(h)}</span>)}</div>
        {ORDER.map((wd) => (
          <div key={wd} className="flex-1">
            <p className="h-6 text-center text-xs font-semibold">{DAYS[wd]}</p>
            <div className="relative rounded-lg border border-border bg-surface" style={{ height: H }}>
              {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-border/50" style={{ top: y(h) }} />)}
              {required.filter((w) => w.weekday === wd).map((w, i) => <div key={"r" + i} className="absolute inset-x-0.5 rounded border-2 border-dashed border-primary/40" style={{ top: y(w.startMinute), height: y(w.endMinute) - y(w.startMinute) }} />)}
              {gaps.filter((w) => w.weekday === wd).map((w, i) => <div key={"g" + i} className="absolute inset-x-1 flex items-center justify-center rounded text-[10px] font-semibold text-error" style={{ top: y(w.startMinute), height: y(w.endMinute) - y(w.startMinute), background: "repeating-linear-gradient(45deg, #fbe3e1, #fbe3e1 6px, #fff 6px, #fff 12px)" }}>GAP</div>)}
              {active.filter((s) => s.weekday === wd).map((s) => { const c = colourFor(workerIds, s.workerId), proposed = s.status === "proposed"; return (
                <div key={s.id} className="absolute inset-x-1.5 overflow-hidden rounded px-1 text-[10px] font-semibold leading-tight" style={{ top: y(s.startMinute), height: y(s.endMinute) - y(s.startMinute), background: proposed ? c + "26" : c, color: proposed ? c : "#fff", border: `2px ${proposed ? "dashed" : "solid"} ${c}` }}>
                  {s.workerName}<br /><span className="font-normal">{hm(s.startMinute)}–{hm(s.endMinute)}{proposed ? " · proposed" : ""}</span></div>); })}
              {overlaps.filter((w) => w.weekday === wd).map((w, i) => <div key={"o" + i} className="pointer-events-none absolute inset-x-0 border-y-2 border-error" style={{ top: y(w.startMinute), height: y(w.endMinute) - y(w.startMinute) }} />)}
            </div>
          </div>))}
      </div></div>
      <p className="mt-2 text-xs text-muted">Dashed outline = hours to cover · hatched “GAP” = not covered · solid = confirmed · light dashed = proposed, awaiting the worker’s confirmation.</p>
    </div>
  );
}
