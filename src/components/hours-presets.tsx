"use client";
import { useState } from "react";

/** Windows per weekday (0 = Sunday ... 6 = Saturday): [start, end] in HH:MM. */
type Windows = Record<number, [string, string][]>;
const weekdays = (a: string, z: string): Windows => ({ 1: [[a, z]], 2: [[a, z]], 3: [[a, z]], 4: [[a, z]], 5: [[a, z]] });
const PRESETS: { label: string; hint: string; windows: Windows }[] = [
  { label: "School hours", hint: "Mon to Fri, 9:00 to 15:00", windows: weekdays("09:00", "15:00") },
  { label: "Weekday mornings", hint: "Mon to Fri, 9:00 to 12:00", windows: weekdays("09:00", "12:00") },
  { label: "Weekday afternoons", hint: "Mon to Fri, 13:00 to 17:00", windows: weekdays("13:00", "17:00") },
  { label: "Evenings", hint: "Mon to Fri, 18:00 to 21:00", windows: weekdays("18:00", "21:00") },
  { label: "Weekends", hint: "Sat and Sun, 9:00 to 17:00", windows: { 6: [["09:00", "17:00"]], 0: [["09:00", "17:00"]] } },
];

/**
 * One-tap starting points for the weekly hours below. They only fill in the time boxes of the form on this page;
 * nothing is saved until the person presses Save, and every box stays editable.
 */
export function HoursPresets({ formId }: { formId: string }) {
  const [said, setSaid] = useState("");
  const apply = (windows: Windows | null, label: string) => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    for (let wd = 0; wd < 7; wd++) {
      for (let s = 0; s < 2; s++) {
        const a = form.elements.namedItem(`w_${wd}_${s}_start`) as HTMLInputElement | null;
        const z = form.elements.namedItem(`w_${wd}_${s}_end`) as HTMLInputElement | null;
        const w = windows?.[wd]?.[s];
        if (a) a.value = w ? w[0] : "";
        if (z) z.value = w ? w[1] : "";
      }
    }
    setSaid(windows ? `${label} filled in below. Change any time you like, then save.` : "All hours cleared. Nothing is saved until you press save.");
  };
  return (
    <div className="rounded-2xl border border-border bg-secondary/40 p-4" role="group" aria-labelledby="presets-h">
      <p id="presets-h" className="text-sm font-bold">Start with a common pattern</p>
      <p className="mt-0.5 text-xs text-muted">Tap one to fill in the hours below. You can adjust every day afterwards.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => apply(p.windows, p.label)} className="min-h-11 rounded-full border border-primary/30 bg-surface px-4 text-left text-sm font-bold text-primary transition-colors hover:bg-secondary" title={p.hint}>
            {p.label}<span className="block text-[11px] font-medium text-muted">{p.hint}</span>
          </button>
        ))}
        <button type="button" onClick={() => apply(null, "")} className="min-h-11 rounded-full px-4 text-sm font-semibold text-muted underline">Clear all</button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-semibold text-success">{said}</p>
    </div>
  );
}
