import type { BodyNights, Point } from "./body";
import { ASSESSMENT_SWC, banded, cv7, lnRmssd, readings, type Position, type Reading, type State } from "./engine/hrv";
import type { Nightly } from "./engine/nights";
import { color } from "./theme";

/**
 * The body read the Altini way, for the screens: the engine's readings over
 * HRV, and the same banding applied to resting heart rate and sleep so every
 * row answers one question — is this week unusual for you?
 */

export interface Banded {
  now: { value: number; low: number; high: number; position: Position } | null;
  /**
   * Per night: value, 7-night mean, and the 60-night band around it — the mean
   * the assessment reads and the range it reads it against — with the band's
   * centre, the 60-night mean.
   */
  series: { night: string; value: number; mean: number | null; low: number | null; high: number | null; normal: number | null }[];
}

export function band(points: Point[], transform?: (v: number) => number, back?: (v: number) => number, { short }: { short?: number } = {}): Banded {
  const t = transform ?? ((v: number) => v);
  const b = back ?? ((v: number) => v);
  const m: Nightly = new Map(points.map(([k, v]) => [k, t(v)]));
  // The same normal range as the assessment, so a chart's band and the verdict beside it agree.
  const bd = banded(m, { swc: ASSESSMENT_SWC, short });
  const series = points.map(([night, value]) => {
    const x = bd.get(night);
    return {
      night,
      value,
      mean: x ? b(x.baseline) : null,
      low: x ? b(x.low) : null,
      high: x ? b(x.high) : null,
      normal: x ? b((x.low + x.high) / 2) : null,
    };
  });
  const last = [...bd.values()].at(-1);
  return { now: last ? { value: b(last.baseline), low: b(last.low), high: b(last.high), position: last.position } : null, series };
}

export interface BodyRead {
  /** Altini state per night, from HRV. */
  readings: Map<string, Reading>;
  latest: (Reading & { night: string }) | null;
  hrv: Banded;
  rhr: Banded;
  sleep: Banded;
  energy: Banded;
  /** The 7-night CV of ln HRV against its own band, night by night, as the assessment reads it (`bodyread.ts`). */
  cv: Banded;
}

export function readBody(b: BodyNights): BodyRead {
  const r = readings(new Map(b.hrv), { swc: ASSESSMENT_SWC });
  const lastNight = [...r.keys()].sort().at(-1);
  return {
    readings: r,
    latest: lastNight ? { ...r.get(lastNight)!, night: lastNight } : null,
    // Banded on the log scale, as the engine reads HRV, and shown back in ms.
    hrv: band(b.hrv, Math.log, Math.exp),
    rhr: band(b.rhr),
    sleep: band(b.sleep),
    energy: band(b.energy),
    cv: band([...cv7(lnRmssd(new Map(b.hrv)))].sort(([x], [y]) => (x < y ? -1 : 1)), undefined, undefined, { short: 1 }),
  };
}

export const STATE: Record<State, { word: string; tint: string; means: string }> = {
  coping: { word: "Coping", tint: "#3E9E6E", means: "Baseline within your normal and the nights steady. Nothing to adjust for." },
  elevated: { word: "Elevated", tint: "#3B5BA9", means: "Baseline above your normal. Usually rest or adaptation." },
  perturbed: { word: "Perturbed", tint: "#C9733F", means: "The nights are jumping around: something acute, whatever the baseline." },
  strained: { word: "Strained", tint: "#C43D4B", means: "Baseline below your normal and the nights unsettled: load and an acute hit together." },
  suppressed: { word: "Suppressed", tint: "#8E2F3A", means: "Baseline below your normal and flat. Accumulated load; a quiet week is not comfort here." },
};

export const metricName = (b: BodyNights) => (b.metric === "sdnn" ? "HRV (SDNN)" : "HRV (rMSSD)");
export const sourceName = (b: BodyNights) =>
  b.source === "apple-health" ? "Apple Health" : b.source === "whoop-synthetic" ? "Synthetic WHOOP data" : "Health Connect";
export const bodyColor = color.body;
