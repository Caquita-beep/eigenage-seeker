import { addDays, type Nightly } from "./nights";

/**
 * Bloodwork against the market: context, never a test.
 *
 * A person has a handful of draws a year. Correlating four numbers with
 * anything is not statistics, and this module does not pretend otherwise. What
 * it can do honestly is put each draw next to what was happening before it,
 * over the window that marker actually integrates — which differs by two
 * orders of magnitude between markers, and is the whole point of doing it per
 * marker rather than with one "last 30 days" for everything.
 *
 * "Your HbA1c was drawn at the end of a quarter where you were up past
 * midnight on 31 of 90 nights" is a fact about the reader's own record. What
 * it means is left to them.
 */

export interface DrawWindow {
  days: number;
  basis: string;
}

export const DRAW_WINDOWS: Record<string, DrawWindow> = {
  hba1c: {
    days: 90,
    basis: "Glycated haemoglobin integrates glucose over the red cell's ~120-day life, weighted to the most recent 30–90 days.",
  },
  "hs-crp": {
    days: 14,
    basis: "CRP has a ~19-hour half-life; a raised value reflects inflammation of the last days to weeks, and poor sleep raises it within that span.",
  },
  glucose: {
    days: 3,
    basis: "One night of restricted sleep measurably worsens next-day insulin sensitivity; fasting glucose reflects the last few days, not months.",
  },
  insulin: {
    days: 3,
    basis: "Fasting insulin tracks the same short-term insulin sensitivity that a few nights of short sleep degrade.",
  },
  triglycerides: {
    days: 3,
    basis: "Fasting triglycerides follow the last days' meals and alcohol — the late-night habits, not the market itself.",
  },
};

export interface DrawContext {
  window: DrawWindow;
  /** Nights in the window with a value. */
  nights: number;
  mean: number | null;
  /** For 0/1 series, how many nights were a 1. */
  count: number;
}

/** The exposure over the window ending the night before the draw. */
export function drawContext(marker: string, drawDay: string, series: Nightly): DrawContext | null {
  const window = DRAW_WINDOWS[marker];
  if (!window) return null;
  const values: number[] = [];
  for (let i = 1; i <= window.days; i++) {
    const v = series.get(addDays(drawDay, -i));
    if (v !== undefined) values.push(v);
  }
  return {
    window,
    nights: values.length,
    mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    count: values.filter((v) => v === 1).length,
  };
}
