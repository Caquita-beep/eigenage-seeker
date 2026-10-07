import type { Data } from "./engine/hypotheses";
import { addDays, type Nightly } from "./engine/nights";
import { comingIn } from "./sport";

/**
 * What moves with what, for the Correlations sub-tab: for one outcome at a
 * time, every factor that could drive it, ranked by how strongly the two move
 * together. Built to avoid the four ways a page of correlations misleads:
 *
 *   Outliers and zeros   Spearman's rank correlation, so one whale day or a
 *                        run of quiet ones does not set the number. Trading
 *                        outcomes count trading days only: how much, when you
 *                        traded, not whether you did.
 *   Drift                HRV and resting heart rate as distance from their
 *                        own 60-night mean, so a season or a fitness block
 *                        does not correlate with a market phase by both
 *                        drifting.
 *   Mechanical pairs     no same-day trading measure against another (a day
 *                        past midnight is a day traded); HRV is not set
 *                        against itself the morning before.
 *   Chance               a band of what chance alone gives, for the days
 *                        that pair and the streaks they come in (lag-1
 *                        autocorrelation shrinks the effective n), widened
 *                        for the number of drivers checked (Bonferroni). Only
 *                        a driver beyond it is called clear.
 *
 * Plain correlations still, not tests: nothing else is held fixed. The
 * Tested links are the tests.
 */

export type Outcome = "hrv" | "moved" | "size" | "trades" | "result";
export type Group = "body" | "market" | "trading";

export const OUTCOMES: { key: Outcome; label: string; title: string }[] = [
  { key: "hrv", label: "HRV", title: "HRV the next morning, against your normal" },
  { key: "moved", label: "Moved", title: "Wallet moved, on days you traded" },
  { key: "size", label: "Size", title: "Typical trade size, on days you traded" },
  { key: "trades", label: "Trades", title: "Number of trades, on days you traded" },
  { key: "result", label: "Result", title: "Next-day result of the day's trades" },
];

export interface Driver {
  label: string;
  group: Group;
  r: number;
  n: number;
  /** |r| beyond which chance alone is unlikely, for this pair's effective n and the drivers checked. */
  band: number;
  clear: boolean;
}

export interface Drivers {
  rows: Driver[];
  /** Days in the outcome. */
  n: number;
}

/** Fewer pairs than this, and a driver is left out. */
const MIN_PAIRS = 20;
/** A personal normal needs this many of the 60 nights before. */
const MIN_NORMAL = 30;

const sortedKeys = (m: Nightly) => [...m.keys()].sort();

/** Distance from the mean of the 60 nights before (the night itself left out). */
function fromNormal(m: Nightly | undefined): Nightly | undefined {
  if (!m) return undefined;
  const keys = sortedKeys(m);
  const out: Nightly = new Map();
  for (let i = 0; i < keys.length; i++) {
    const from = addDays(keys[i], -60);
    let s = 0;
    let n = 0;
    for (let k = i - 1; k >= 0 && keys[k] >= from; k--) {
      s += m.get(keys[k])!;
      n++;
    }
    if (n >= MIN_NORMAL) out.set(keys[i], m.get(keys[i])! - s / n);
  }
  return out;
}

/** The 7-night CV of ln rMSSD, percent, on nights with at least 5 of the 7. */
function cv7(ln: Nightly | undefined): Nightly | undefined {
  if (!ln) return undefined;
  const out: Nightly = new Map();
  for (const night of ln.keys()) {
    const xs: number[] = [];
    for (let k = 0; k < 7; k++) {
      const v = ln.get(addDays(night, -k));
      if (v !== undefined) xs.push(v);
    }
    if (xs.length < 5) continue;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    out.set(night, (100 * sd) / m);
  }
  return out;
}

/** Night D − 1's value under night D: the state on waking, before the day. */
function morningOf(m: Nightly | undefined): Nightly | undefined {
  if (!m) return undefined;
  const out: Nightly = new Map();
  for (const [k, v] of m) out.set(addDays(k, 1), v);
  return out;
}

const only = (m: Nightly | undefined, keep: (v: number) => boolean): Nightly | undefined => (m ? new Map([...m].filter(([, v]) => keep(v))) : undefined);
const mapValues = (m: Nightly | undefined, f: (v: number) => number): Nightly | undefined => (m ? new Map([...m].map(([k, v]) => [k, f(v)])) : undefined);

/** Average ranks, ties sharing theirs. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
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

/** Lag-1 autocorrelation of a series in date order. */
const lag1 = (xs: number[]) => (xs.length > 3 ? (pearson(xs.slice(0, -1), xs.slice(1)) ?? 0) : 0);

/** The standard normal quantile (Acklam's approximation, error under 1e-9). */
function zOf(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -zOf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Spearman's r of a driver against the outcome, on the nights both have, with its effective n. */
function spearman(x: Nightly, y: Nightly): { r: number; n: number; nEff: number } | null {
  const nights = sortedKeys(y).filter((k) => x.has(k) && Number.isFinite(x.get(k)!) && Number.isFinite(y.get(k)!));
  if (nights.length < MIN_PAIRS) return null;
  const xs = nights.map((k) => x.get(k)!);
  const ys = nights.map((k) => y.get(k)!);
  const r = pearson(ranks(xs), ranks(ys));
  if (r === null) return null;
  // Streaks: days that run together carry less than a day's worth each (Bartlett's adjustment).
  const p = Math.max(-0.9, Math.min(0.9, lag1(xs) * lag1(ys)));
  const nEff = Math.max(4, Math.min(nights.length, (nights.length * (1 - p)) / (1 + p)));
  return { r, n: nights.length, nEff };
}

/**
 * Every driver of one outcome, strongest first. `sizes` is each trading
 * night's typical trade in USD (the median), from the journal.
 */
export function drivers(d: Data, sizes: Nightly, moon: Nightly, outcome: Outcome): Drivers {
  const share = d["wallet:share"];
  const traded = (m: Nightly | undefined) => (m && share ? new Map([...m].filter(([k]) => (share.get(k) ?? 0) > 0)) : undefined);
  const hrvDev = fromNormal(d["health:ln"]);
  const logSize = mapValues(sizes, Math.log);
  const load7: Nightly = new Map();
  if (share) for (const k of share.keys()) {
    const r = comingIn(share, k);
    if (r !== null) load7.set(k, r);
  }

  const body: [string, Nightly | undefined][] = [
    ["HRV that morning", morningOf(hrvDev)],
    ["Resting HR that morning", morningOf(fromNormal(d["health:rhr"]))],
    ["Sleep the night before", morningOf(d["health:sleep"])],
    ["CV that morning", morningOf(cv7(d["health:ln"]))],
  ];
  const market: [string, Nightly | undefined][] = [
    ["SOL's day (up or down)", d["market:return"]],
    ["SOL move size", d["market:abs-return"]],
    ["DVOL", d["market:dvol"]],
    ["Fear & Greed", d["market:fng"]],
    ["Your coins' day", d["wallet:pnl"]],
  ];
  // Moonlight (`moon.ts`): of the night slept for the next morning's HRV; of the night before for the day's trading.
  const moonThatNight: [string, Nightly | undefined][] = [["Moonlight that night", moon]];
  const moonBefore: [string, Nightly | undefined][] = [["Moonlight the night before", morningOf(moon)]];
  const coming: [string, Nightly | undefined][] = [["Previous 7 days' load", load7]];
  const trading: [string, Nightly | undefined][] = [
    ["Wallet moved", share],
    ["Trades", d["wallet:swaps"]],
    ["Trade size", logSize],
    ["On-chain past midnight", d["wallet:awake"]],
    ["Failed transactions", d["wallet:failed"]],
  ];

  let y: Nightly | undefined;
  let xs: [string, Group, Nightly | undefined][];
  const tag = (g: Group, list: [string, Nightly | undefined][]) => list.map(([l, m]) => [l, g, m] as [string, Group, Nightly | undefined]);
  switch (outcome) {
    case "hrv":
      // The day's trading and market against the sleep after it. Not HRV against itself the morning before.
      y = hrvDev;
      xs = [...tag("trading", trading), ...tag("trading", coming), ...tag("market", [...market, ["Coins vs cost", d["wallet:water"]], ...moonThatNight])];
      break;
    case "moved":
    case "size":
    case "trades":
      // Known on waking or during the day; never another same-day trading measure.
      y = outcome === "moved" ? traded(share) : outcome === "size" ? logSize : only(d["wallet:swaps"], (v) => v > 0);
      xs = [...tag("body", body), ...tag("trading", coming), ...tag("market", [...market, ["Coins vs cost that morning", morningOf(d["wallet:water"])], ...moonBefore])];
      break;
    case "result":
      y = d["wallet:result"];
      xs = [...tag("body", body), ...tag("trading", [...trading.filter(([l]) => l !== "Failed transactions"), ...coming]), ...tag("market", [...market, ["Coins vs cost that morning", morningOf(d["wallet:water"])], ...moonBefore])];
      break;
  }
  if (!y?.size) return { rows: [], n: 0 };

  const found = xs.flatMap(([label, group, x]) => {
    const c = x ? spearman(x, y!) : null;
    return c ? [{ label, group, ...c }] : [];
  });
  // Chance, widened for every driver this outcome checks: the 5% shared among them.
  const z = zOf(1 - 0.05 / (2 * Math.max(found.length, 1)));
  const rows = found
    .map(({ label, group, r, n, nEff }) => {
      const band = Math.tanh(z / Math.sqrt(Math.max(nEff - 3, 1)));
      return { label, group, r, n, band, clear: Math.abs(r) > band };
    })
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return { rows, n: y.size };
}

/** Each trading night's typical trade in USD: the median of its trades. */
export function sizesByNight(fills: { night: string; usd: number | null }[]): Nightly {
  const by = new Map<string, number[]>();
  for (const f of fills) if (f.usd && f.usd > 0) by.set(f.night, [...(by.get(f.night) ?? []), f.usd]);
  const out: Nightly = new Map();
  for (const [night, xs] of by) {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    out.set(night, s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  }
  return out;
}
