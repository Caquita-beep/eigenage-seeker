/**
 * The statistics, small enough to read in one sitting.
 *
 * One model for every question: ordinary least squares of the outcome on the
 * exposure, weekday dummies and any named covariates, with the exposure's
 * coefficient as the effect. Weekday dummies are there because both sides carry
 * a weekly cycle — HRV from weekend drinking and Monday training, markets and
 * wallets from the working week — and two weekly cycles correlate with each
 * other out of nothing.
 *
 * The interval comes from a circular block bootstrap, not the textbook formula.
 * HRV is autocorrelated day to day and volatility clusters; the textbook
 * standard error assumes independent days, is far too narrow on both, and
 * manufactures significance. Resampling whole weeks keeps the autocorrelation
 * inside each resample, so the interval is as wide as the data really is.
 *
 * Seeded, so the same data always prints the same interval. A number that
 * changes on reload is a number nobody should trust.
 */

/** mulberry32. Small, fast, and good enough for resampling indices. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Least-squares coefficients for `y ≈ X·b`, via the normal equations.
 *
 * A whisker of ridge on the diagonal keeps it solvable when a resample happens
 * to miss a weekday entirely; at 1e-8 it moves no real coefficient.
 */
export function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const row = X[r];
    for (let i = 0; i < k; i++) {
      A[i][k] += row[i] * y[r];
      for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-8;

  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

export interface Row {
  x: number;
  /** A second exposure, for a race between two (see `race`). Column 2. */
  x2?: number;
  y: number;
  /** Null on weekly rows, which have no weekday cycle left to remove. */
  weekday: number | null;
  covariates: number[];
}

/** Intercept, exposure, six weekday dummies (nightly rows only), covariates.
 *  Exposure is column 1. */
function design(rows: Row[]): number[][] {
  return rows.map((r) => [
    1,
    r.x,
    ...(r.x2 === undefined ? [] : [r.x2]),
    ...(r.weekday === null ? [] : [1, 2, 3, 4, 5, 6].map((d) => (r.weekday === d ? 1 : 0))),
    ...r.covariates,
  ]);
}

export function effect(rows: Row[]): number | null {
  const b = ols(design(rows), rows.map((r) => r.y));
  return b ? b[1] : null;
}

/** Inverse standard normal CDF (Acklam), accurate to ~1e-9. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo || p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(p < lo ? p : 1 - p));
    const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < lo ? x : -x;
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Student's t quantile, by the Cornish–Fisher expansion. Fine for df ≥ 10. */
export function tQuantile(p: number, df: number): number {
  const z = normalQuantile(p);
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
}

/**
 * Circular block bootstrap of the exposure coefficient.
 *
 * Rows must be in night order. Blocks of `block` consecutive nights are drawn
 * with wrap-around until n rows are filled, and the spread of the resampled
 * coefficients is the standard error.
 *
 * ── Why the SE, not the percentiles ──────────────────────────────────────
 * The percentile interval is the usual choice and it runs liberal at n ≈ 60:
 * on 400 simulated readers with no effect, autocorrelated HRV and a weekly
 * cycle on both sides, it fired 5.3–7.3% of the time at a nominal 5%.
 * Estimate ± t × bootstrap SE fired 5.0–6.0% on the same data. A naive
 * correlation fired 11.5%.
 */
export function bootstrapInterval(
  rows: Row[],
  confidence: number,
  { reps = 2000, block = 7, seed = 1 } = {},
): [number, number] | null {
  const n = rows.length;
  const est = effect(rows);
  if (est === null) return null;
  const rand = rng(seed);
  const draws: number[] = [];
  const sample: Row[] = new Array(n);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < n; ) {
      const start = Math.floor(rand() * n);
      for (let j = 0; j < block && i < n; j++, i++) sample[i] = rows[(start + j) % n];
    }
    const e = effect(sample);
    if (e !== null && Number.isFinite(e)) draws.push(e);
  }
  if (draws.length < reps * 0.9) return null;
  const m = draws.reduce((s, x) => s + x, 0) / draws.length;
  const se = Math.sqrt(draws.reduce((s, x) => s + (x - m) ** 2, 0) / (draws.length - 1));
  const params = design(rows.slice(0, 1))[0].length;
  const half = tQuantile(1 - (1 - confidence) / 2, n - params) * se;
  return [est - half, est + half];
}

/**
 * Two exposures in one model, and which one the outcome follows.
 *
 * Built for one question — does the body track the volatility the market
 * EXPECTS or the volatility it DELIVERED — where the two move together most of
 * the time. Fitting each alone would credit both with their shared movement.
 * Fitting both together credits each only with what the other cannot explain,
 * and the gap between the two coefficients, with its own interval, is the
 * answer. They must be on the same scale for the gap to mean anything; implied
 * and realised volatility are both annualised percent.
 *
 * When they move together almost perfectly the intervals widen until the answer
 * is "cannot tell", which is correct: the data holds no contrast to decide on.
 */
export interface Race {
  first: { effect: number; interval: [number, number] };
  second: { effect: number; interval: [number, number] };
  /** first − second. */
  gap: { effect: number; interval: [number, number] };
  /** Correlation between the two exposures. Near 1 means little to decide on. */
  overlap: number;
}

function coefs(rows: Row[]): [number, number] | null {
  const b = ols(design(rows), rows.map((r) => r.y));
  return b ? [b[1], b[2]] : null;
}

export function race(
  rows: Row[],
  confidence: number,
  { reps = 2000, block = 4, seed = 1 } = {},
): Race | null {
  const n = rows.length;
  const est = coefs(rows);
  if (!est) return null;
  const rand = rng(seed);
  const d1: number[] = [], d2: number[] = [], dg: number[] = [];
  const sample: Row[] = new Array(n);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < n; ) {
      const start = Math.floor(rand() * n);
      for (let j = 0; j < block && i < n; j++, i++) sample[i] = rows[(start + j) % n];
    }
    const c = coefs(sample);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    d1.push(c[0]); d2.push(c[1]); dg.push(c[0] - c[1]);
  }
  if (d1.length < reps * 0.9) return null;
  const q = tQuantile(1 - (1 - confidence) / 2, n - design(rows.slice(0, 1))[0].length);
  const sd = (xs: number[]) => {
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  };
  const band = (e: number, xs: number[]): { effect: number; interval: [number, number] } => ({
    effect: e,
    interval: [e - q * sd(xs), e + q * sd(xs)],
  });
  const xs = rows.map((r) => r.x), ys = rows.map((r) => r.x2!);
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
  }
  return {
    first: band(est[0], d1),
    second: band(est[1], d2),
    gap: band(est[0] - est[1], dg),
    overlap: sxy / Math.sqrt(sxx * syy),
  };
}
