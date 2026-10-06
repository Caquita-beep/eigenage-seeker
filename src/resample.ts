import type { Values } from "./indicators";
import type { Pane } from "./prochart";

/**
 * Resolution for the daily charts: the same series as weekly means.
 *
 * Every line and band in every pane is averaged over its week (Monday to
 * Sunday, UTC), ignoring missing days, so a week with one reading is that
 * reading and a week with none stays empty rather than becoming zero. Bars
 * keep the colour of the week's last coloured day.
 */

/** Monday of the week a `YYYY-MM-DD` date falls in. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function groups(days: string[]): { week: string; idx: number[] }[] {
  const out: { week: string; idx: number[] }[] = [];
  days.forEach((day, i) => {
    const w = weekOf(day);
    if (out.at(-1)?.week === w) out.at(-1)!.idx.push(i);
    else out.push({ week: w, idx: [i] });
  });
  return out;
}

const meanOf = (vs: Values, idx: number[]) => {
  const xs = idx.map((i) => vs[i]).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

export function toWeekly(days: string[], panes: Pane[]): { days: string[]; panes: Pane[] } {
  return resample(days, panes, groups(days));
}

/** The same series as calendar-month means, keyed by the 1st of each month. */
export function toMonthly(days: string[], panes: Pane[]): { days: string[]; panes: Pane[] } {
  const g: { week: string; idx: number[] }[] = [];
  days.forEach((day, i) => {
    const m = `${day.slice(0, 7)}-01`;
    if (g.at(-1)?.week === m) g.at(-1)!.idx.push(i);
    else g.push({ week: m, idx: [i] });
  });
  return resample(days, panes, g);
}

function resample(days: string[], panes: Pane[], g: { week: string; idx: number[] }[]): { days: string[]; panes: Pane[] } {
  const avg = (vs: Values): Values => g.map(({ idx }) => meanOf(vs, idx));
  return {
    days: g.map((x) => x.week),
    panes: panes.map((p) => ({
      ...p,
      lines: p.lines.map((l) => ({
        ...l,
        values: avg(l.values),
        barColors: l.barColors
          ? g.map(({ idx }) => {
              const last = [...idx].reverse().find((i) => l.values[i] !== null && l.values[i] !== undefined);
              return l.barColors![last ?? idx[idx.length - 1]];
            })
          : undefined,
      })),
      bands: p.bands?.map((b) => ({ ...b, low: avg(b.low), high: avg(b.high) })),
    })),
  };
}

/** Window presets in weeks, for a weekly chart. */
export const WEEK_PRESETS = [
  { label: "3M", count: 13 },
  { label: "6M", count: 26 },
  { label: "1Y", count: 52 },
  { label: "2Y", count: 104 },
  { label: "All", count: 100_000 },
];

/** Window presets in months, for a monthly chart. */
export const MONTH_PRESETS = [
  { label: "6M", count: 6 },
  { label: "1Y", count: 12 },
  { label: "All", count: 100_000 },
];

/** Window presets in hours, for an hourly chart. */
export const HOUR_PRESETS = [
  { label: "1D", count: 24 },
  { label: "3D", count: 72 },
  { label: "1W", count: 168 },
  { label: "All", count: 100_000 },
];
