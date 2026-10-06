import { addDays, weekday, type Nightly } from "./nights";

/**
 * Weeks, for the questions about regimes rather than days.
 *
 * A 7-night CV computed every night overlaps its neighbour by six nights, so a
 * daily series of it is mostly the same number repeated — sixty of them carry
 * about nine weeks of information, and a test that counts them as sixty is
 * lying about its n. Regime questions are therefore asked of non-overlapping
 * weeks, keyed by the Monday that starts them, and need half a year of them.
 */

/** The Monday on or before the night. */
export function weekOf(night: string): string {
  return addDays(night, -((weekday(night) + 6) % 7));
}

/** Nightly values grouped into weeks, with at least `min` nights each. */
function groups(series: Nightly, min: number): Map<string, number[]> {
  const g = new Map<string, number[]>();
  for (const [night, v] of series) {
    const w = weekOf(night);
    if (!g.has(w)) g.set(w, []);
    g.get(w)!.push(v);
  }
  for (const [w, vs] of g) if (vs.length < min) g.delete(w);
  return g;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export function weeklyMean(series: Nightly, min = 5): Nightly {
  const out: Nightly = new Map();
  for (const [w, vs] of groups(series, min)) out.set(w, mean(vs));
  return out;
}

export function weeklySum(series: Nightly): Nightly {
  const out: Nightly = new Map();
  for (const [w, vs] of groups(series, 7)) out.set(w, vs.reduce((s, x) => s + x, 0));
  return out;
}

/** The body's weekly CV: SD / mean of that week's ln rMSSD, percent. */
export function weeklyCv(ln: Nightly, min = 5): Nightly {
  const out: Nightly = new Map();
  for (const [w, vs] of groups(ln, min)) out.set(w, (100 * sd(vs)) / mean(vs));
  return out;
}

/**
 * The market's realised volatility for the week, annualised in percent so it
 * sits on DVOL's scale: SD of daily log returns × √365. Crypto trades every
 * day, hence 365 and not 252.
 */
export function weeklyRealisedVol(returns: Nightly): Nightly {
  const out: Nightly = new Map();
  for (const [w, vs] of groups(returns, 6)) out.set(w, 100 * sd(vs) * Math.sqrt(365));
  return out;
}

/**
 * Acute:chronic load, uncoupled: this week against the mean of the FOUR BEFORE
 * it. The common version puts the acute week inside its own chronic average,
 * which correlates the ratio with the acute load by arithmetic alone
 * (Impellizzeri et al. 2020 on the training-load version of exactly this).
 */
export function loadRatio(weekly: Nightly): Nightly {
  const out: Nightly = new Map();
  for (const [w, v] of weekly) {
    const prior = [1, 2, 3, 4].map((i) => weekly.get(addDays(w, -7 * i)));
    if (prior.some((p) => p === undefined)) continue;
    const chronic = mean(prior as number[]);
    if (chronic > 0) out.set(w, v / chronic);
  }
  return out;
}
