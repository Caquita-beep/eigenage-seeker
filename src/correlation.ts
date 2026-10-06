import type { MarketView } from "./market";

/**
 * How the market's pieces move together: the correlation of their daily
 * changes over a trailing 30 days, day by day. SOL against BTC (the log
 * return of each), and SOL against priced fear (SOL's log return against
 * the day's change in DVOL). Changes, not levels: two series that trend over
 * the same months correlate by drift alone.
 */

export const CORR_DAYS = 30;
/** Most of the window present, or the figure is a guess. */
const MIN_PAIRS = 20;

export interface Correlations {
  solBtc: [string, number][];
  solFear: [string, number][];
}

/** Each day's change from the day before it in the series: a log return, or a plain difference. */
function changes(pts: [string, number][], log: boolean): Map<string, number> {
  const s = [...pts].sort(([a], [b]) => (a < b ? -1 : 1));
  const out = new Map<string, number>();
  for (let i = 1; i < s.length; i++) {
    const [, a] = s[i - 1];
    const [day, b] = s[i];
    if (log ? a > 0 && b > 0 : true) out.set(day, log ? Math.log(b / a) : b - a);
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** The correlation over the trailing CORR_DAYS calendar days, for each day both series have a change. */
function rolling(a: Map<string, number>, b: Map<string, number>): [string, number][] {
  const days = [...a.keys()].filter((d) => b.has(d)).sort();
  const out: [string, number][] = [];
  for (let i = 0; i < days.length; i++) {
    const from = new Date(`${days[i]}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - (CORR_DAYS - 1));
    const start = from.toISOString().slice(0, 10);
    const w = days.slice(0, i + 1).filter((d) => d >= start);
    if (w.length < MIN_PAIRS) continue;
    const r = pearson(
      w.map((d) => a.get(d)!),
      w.map((d) => b.get(d)!),
    );
    if (r !== null) out.push([days[i], r]);
  }
  return out;
}

export function correlations(v: MarketView): Correlations {
  const sol = changes(
    v.solBars.map((x) => [x.day, x.close]),
    true,
  );
  return {
    solBtc: rolling(sol, changes(v.btcBars.map((x) => [x.day, x.close]), true)),
    solFear: rolling(sol, changes(v.dvolSeries.map((d) => [d.day, d.value]), false)),
  };
}

/** How strongly, in a word: the size of the correlation, whichever its sign. */
export function strength(r: number): string {
  const a = Math.abs(r);
  const word = a >= 0.7 ? "Strong" : a >= 0.4 ? "Moderate" : "Weak";
  return r < 0 && a >= 0.4 ? `${word}, inverse` : word;
}

export const signedR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}`;
