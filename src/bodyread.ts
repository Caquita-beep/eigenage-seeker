import type { BodyNights } from "./body";
import { ASSESSMENT_SWC, banded, cv7, lnRmssd, trends, type Arrow, type Position, type Response } from "./engine/hrv";
import { addDays, type Nightly } from "./engine/nights";

/**
 * The Body tab's figures, in the two layers of the method:
 *
 *   last night   this morning's HRV against the reader's usual range — where
 *                two of every three of their last 60 nights fall (the 17th to
 *                83rd percentile). One night is mostly noise, so this range is
 *                wide on purpose; it says whether last night was unusual, not
 *                whether anything is wrong.
 *   the trend    the last 7 nights of three signals, each against its own
 *                60-night band (`engine/hrv.ts`): HRV baseline, resting heart
 *                rate, and the night-to-night CV. Together they name the
 *                response — the part the advice follows.
 *
 * Every figure is the reader's own: no population norms anywhere.
 */

export interface Figure {
  value: number;
  low: number;
  high: number;
  arrow: Arrow;
}

/** One night on a chart: the night's own value, and the 7-night value with its band. */
export interface ChartPoint {
  night: string;
  value: number | null;
  avg: number | null;
  low: number | null;
  high: number | null;
}

export interface BodyDetail {
  lastNight: { night: string; hrv: number; low: number; high: number; position: Position } | null;
  response: Response | null;
  hrv: Figure | null;
  rhr: Figure | null;
  cv: Figure | null;
  sleep: (Figure & { lastNight: number }) | null;
  /** The last 14 nights' responses, oldest first; null where there was no reading. */
  history: { night: string; response: Response | null }[];
  /** The last 90 days of each signal, for the charts. */
  charts: { hrv: ChartPoint[]; cv: ChartPoint[]; rhr: ChartPoint[] };
}

const CHART_NIGHTS = 90;

/** A signal's last 90 days: its daily values, and the 7-day value and band where one exists. */
function chart(nightly: Nightly, bandOn: Nightly, back: (v: number) => number, last: string, opts?: { short?: number }): ChartPoint[] {
  const b = banded(bandOn, { swc: ASSESSMENT_SWC, ...opts });
  const out: ChartPoint[] = [];
  for (let i = CHART_NIGHTS - 1; i >= 0; i--) {
    const night = addDays(last, -i);
    const x = b.get(night);
    const v = nightly.get(night);
    out.push({ night, value: v ?? null, avg: x ? back(x.baseline) : null, low: x ? back(x.low) : null, high: x ? back(x.high) : null });
  }
  return out;
}

const arrowOf = (p: Position): Arrow => (p === "above" ? "up" : p === "below" ? "down" : "flat");

function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = q * (s.length - 1);
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
}

function lastFigure(series: Nightly, back?: (v: number) => number, opts?: { short?: number }): Figure | null {
  const b = [...banded(series, { swc: ASSESSMENT_SWC, ...opts }).entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).at(-1)?.[1];
  if (!b) return null;
  const f = back ?? ((v: number) => v);
  return { value: f(b.baseline), low: f(b.low), high: f(b.high), arrow: arrowOf(b.position) };
}

export function bodyDetail(body: BodyNights): BodyDetail {
  const rmssd: Nightly = new Map(body.hrv);
  const ln = lnRmssd(rmssd);

  let lastNight: BodyDetail["lastNight"] = null;
  if (body.hrv.length) {
    const [night, hrv] = body.hrv.at(-1)!;
    const prev = body.hrv.filter(([k]) => k < night && k >= addDays(night, -60)).map(([, v]) => v);
    if (prev.length >= 30) {
      const low = percentile(prev, 1 / 6);
      const high = percentile(prev, 5 / 6);
      lastNight = { night, hrv, low, high, position: hrv < low ? "below" : hrv > high ? "above" : "within" };
    }
  }

  const t = trends(rmssd, body.rhr.length ? new Map(body.rhr) : undefined, { swc: ASSESSMENT_SWC });
  const lastTrend = [...t.keys()].sort().at(-1);

  const sleepFig = body.sleep.length ? lastFigure(new Map(body.sleep)) : null;

  const history: BodyDetail["history"] = [];
  if (lastTrend) {
    for (let i = 13; i >= 0; i--) {
      const night = addDays(lastTrend, -i);
      history.push({ night, response: t.get(night)?.response ?? null });
    }
  }

  const lastNightKey = body.hrv.at(-1)?.[0] ?? "";
  const id = (v: number) => v;
  const cvSeries = cv7(ln);
  const charts = lastNightKey
    ? {
        hrv: chart(rmssd, ln, Math.exp, lastNightKey),
        // The CV is already a 7-night figure; the dots and the line are the same thing.
        cv: chart(cvSeries, cvSeries, id, lastNightKey, { short: 1 }),
        rhr: body.rhr.length ? chart(new Map(body.rhr), new Map(body.rhr), id, lastNightKey) : [],
      }
    : { hrv: [], cv: [], rhr: [] };

  return {
    charts,
    lastNight,
    response: lastTrend ? t.get(lastTrend)!.response : null,
    hrv: lastFigure(ln, Math.exp),
    rhr: body.rhr.length ? lastFigure(new Map(body.rhr)) : null,
    // The CV's own band is read night by night, as the engine reads it.
    cv: lastFigure(cv7(ln), undefined, { short: 1 }),
    sleep: sleepFig ? { ...sleepFig, lastNight: body.sleep.at(-1)![1] } : null,
    history,
  };
}
