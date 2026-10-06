import type { Candle } from "./candles";
import { INDICATORS_BY_KEY, type Bar } from "./engine/market";
import type { Nightly } from "./engine/nights";

/**
 * Chart indicators, by position in the candle list rather than by date, so
 * they work on 15-minute candles as well as daily ones. Parameters are the
 * ones the Binance app defaults to, so a reader who knows those charts reads
 * these the same way.
 *
 * Everything is computed over the full history and then windowed by the
 * chart, so a 99-period average at the left edge of the view is still a
 * 99-period average.
 */

export type Values = (number | null)[];

export function sma(xs: number[], n: number): Values {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x;
    if (i >= n) sum -= xs[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}

/** EMA over a series that may start with gaps; seeded with the mean of its first `n` values. */
export function ema(xs: Values, n: number): Values {
  const k = 2 / (n + 1);
  const out: Values = [];
  let prev: number | null = null;
  let seed: number[] = [];
  for (const x of xs) {
    if (x === null) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      seed.push(x);
      if (seed.length < n) {
        out.push(null);
        continue;
      }
      prev = seed.reduce((s, v) => s + v, 0) / n;
      seed = [];
    } else {
      prev = x * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function bollinger(xs: number[], n = 20, k = 2) {
  const mid = sma(xs, n);
  const low: Values = [];
  const high: Values = [];
  xs.forEach((_, i) => {
    const m = mid[i];
    if (m === null) return (low.push(null), high.push(null));
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (xs[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    low.push(m - k * sd);
    high.push(m + k * sd);
  });
  return { mid, low, high };
}

/** Wilder's RSI. */
export function rsi(xs: number[], n: number): Values {
  const out: Values = [null];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
      out.push(i < n ? null : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
      continue;
    }
    gain = (gain * (n - 1) + g) / n;
    loss = (loss * (n - 1) + l) / n;
    out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

export function macd(xs: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(xs, fast);
  const s = ema(xs, slow);
  const dif: Values = xs.map((_, i) => (f[i] === null || s[i] === null ? null : f[i]! - s[i]!));
  const dea = ema(dif, signal);
  // Binance draws the histogram at twice the gap.
  const hist: Values = dif.map((d, i) => (d === null || dea[i] === null ? null : 2 * (d - dea[i]!)));
  return { dif, dea, hist };
}

export function kdj(cs: Candle[], n = 9, m1 = 3, m2 = 3) {
  const k: Values = [];
  const d: Values = [];
  const j: Values = [];
  let pk = 50;
  let pd = 50;
  cs.forEach((c, i) => {
    if (i < n - 1) return (k.push(null), d.push(null), j.push(null));
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = i - n + 1; x <= i; x++) {
      lo = Math.min(lo, cs[x].l);
      hi = Math.max(hi, cs[x].h);
    }
    const rsv = hi === lo ? 50 : ((c.c - lo) / (hi - lo)) * 100;
    pk = ((m1 - 1) * pk + rsv) / m1;
    pd = ((m2 - 1) * pd + pk) / m2;
    k.push(pk);
    d.push(pd);
    j.push(3 * pk - 2 * pd);
  });
  return { k, d, j };
}

/** A nightly map laid onto a list of days, null where it has no value. */
export function align(days: string[], m: Nightly): Values {
  return days.map((day) => (m.has(day) ? m.get(day)! : null));
}

/* ── What the chart offers ──────────────────────────────────────────────── */

export const UP = "#0ECB81";
export const DOWN = "#F6465D";
const C1 = "#F0B90B";
const C2 = "#E84DC7";
const C3 = "#9B6BF2";

export interface Line {
  key: string;
  label: string;
  values: Values;
  color: string;
  kind?: "line" | "bars" | "dots" | "area";
  /** Per-bar colours for `bars`. */
  barColors?: string[];
  dashed?: boolean;
  width?: number;
  /** Draw straight across missing values instead of breaking: a nightly series has nights without a reading. */
  bridge?: boolean;
}

export interface MainDef {
  key: "MA" | "EMA" | "BOLL";
  lines: (closes: number[]) => Line[];
}

export const MAIN: MainDef[] = [
  { key: "MA", lines: (c) => [7, 25, 99].map((n, i) => ({ key: `ma${n}`, label: `MA(${n})`, values: sma(c, n), color: [C1, C2, C3][i] })) },
  { key: "EMA", lines: (c) => [7, 25, 99].map((n, i) => ({ key: `ema${n}`, label: `EMA(${n})`, values: ema(c, n), color: [C1, C2, C3][i] })) },
  {
    key: "BOLL",
    lines: (c) => {
      const b = bollinger(c);
      return [
        { key: "up", label: "UP", values: b.high, color: C1 },
        { key: "mb", label: "MB", values: b.mid, color: C2 },
        { key: "dn", label: "DN", values: b.low, color: C3 },
      ];
    },
  },
];

export interface SubDef {
  key: string;
  title: string;
  /** Daily candles only: these are the engine's Exposure indicators, defined per day. */
  daily?: boolean;
  why?: string;
  domain?: [number, number];
  guides?: number[];
  format: (v: number) => string;
  lines: (cs: Candle[]) => Line[];
}

const compact = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : v.toFixed(2);

/** The engine's indicator for daily candles, laid back onto them by date. */
function engineLine(key: string, color: string, cs: Candle[]): Line {
  const bars: Bar[] = cs.map((c) => ({ day: new Date(c.t).toISOString().slice(0, 10), open: c.o, high: c.h, low: c.l, close: c.c }));
  const m = INDICATORS_BY_KEY[key].compute(bars);
  return { key, label: INDICATORS_BY_KEY[key].label, values: align(bars.map((b) => b.day), m), color, kind: "bars" };
}

export const SUBS: SubDef[] = [
  {
    key: "VOL",
    title: "VOL",
    format: compact,
    lines: (cs) => {
      const v = cs.map((c) => c.v);
      return [
        { key: "vol", label: "VOL", values: v, color: UP, kind: "bars", barColors: cs.map((c) => (c.c >= c.o ? UP : DOWN)) },
        { key: "ma5", label: "MA(5)", values: sma(v, 5), color: C1 },
        { key: "ma10", label: "MA(10)", values: sma(v, 10), color: C2 },
      ];
    },
  },
  {
    key: "MACD",
    title: "MACD(12,26,9)",
    format: (v) => v.toFixed(3),
    lines: (cs) => {
      const m = macd(cs.map((c) => c.c));
      return [
        { key: "hist", label: "MACD", values: m.hist, color: UP, kind: "bars", barColors: m.hist.map((h) => ((h ?? 0) >= 0 ? UP : DOWN)) },
        { key: "dif", label: "DIF", values: m.dif, color: C1 },
        { key: "dea", label: "DEA", values: m.dea, color: C2 },
      ];
    },
  },
  {
    key: "RSI",
    title: "RSI",
    domain: [0, 100],
    guides: [30, 70],
    format: (v) => v.toFixed(2),
    lines: (cs) => {
      const c = cs.map((x) => x.c);
      return [6, 12, 24].map((n, i) => ({ key: `rsi${n}`, label: `RSI(${n})`, values: rsi(c, n), color: [C1, C2, C3][i] }));
    },
  },
  {
    key: "KDJ",
    title: "KDJ(9,3,3)",
    format: (v) => v.toFixed(2),
    guides: [20, 80],
    lines: (cs) => {
      const r = kdj(cs);
      return [
        { key: "k", label: "K", values: r.k, color: C1 },
        { key: "d", label: "D", values: r.d, color: C2 },
        { key: "j", label: "J", values: r.j, color: C3 },
      ];
    },
  },
  {
    key: "SHOCK",
    title: "Surprise",
    daily: true,
    why: INDICATORS_BY_KEY["shock"].why,
    guides: [2],
    format: (v) => `${v.toFixed(1)}σ`,
    lines: (cs) => [engineLine("shock", "#E5A06B", cs)],
  },
  {
    key: "SWING",
    title: "Intraday swing",
    daily: true,
    why: INDICATORS_BY_KEY["range"].why,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    lines: (cs) => [engineLine("range", C1, cs)],
  },
  {
    key: "DRAWDOWN",
    title: "Drawdown",
    daily: true,
    why: INDICATORS_BY_KEY["drawdown"].why,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    lines: (cs) => [{ ...engineLine("drawdown", DOWN, cs), kind: "area" }],
  },
];
