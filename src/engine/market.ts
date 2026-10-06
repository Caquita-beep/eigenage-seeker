import type { Nightly } from "./nights";

/**
 * Price action, turned into things a body could plausibly feel.
 *
 * ── Which indicators, and why not the rest ───────────────────────────────
 * Trading indicators are built to answer "what will price do next?". That is
 * not our question. Ours is "what did this day feel like to someone holding
 * the asset?", so each one here is kept only if it names an experience, and it
 * says which one in `why` — the same discipline as `basis` on every marker.
 *
 * MACD, moving-average crosses, Ichimoku and the rest of the trend-following
 * family are left out on purpose: they are smoothed forecasts, they lag by
 * construction, and nobody loses sleep over a signal line crossing. Adding
 * them would only add tests, and every extra test is another chance of a false
 * positive (see `hypotheses.ts`).
 *
 * ── The day ───────────────────────────────────────────────────────────────
 * Bars are UTC days. In Ecuador a UTC day runs 19:00 to 19:00, so it is the
 * night's day give or take the evening — close enough for a daily series, and
 * the alternative (rebuilding bars per reader timezone from minute data) buys
 * nothing at n = 60.
 */

export interface Bar {
  /** UTC date the bar opened, `YYYY-MM-DD`. */
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Indicator {
  key: string;
  label: string;
  /** What the day felt like, in plain words. Shown next to any result. */
  why: string;
  compute(bars: Bar[]): Nightly;
}

/** Trailing window for "normal" volatility, in days. */
const BASELINE_DAYS = 30;

function logReturns(bars: Bar[]): (number | null)[] {
  return bars.map((b, i) => (i === 0 ? null : Math.log(b.close / bars[i - 1].close)));
}

function sd(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function series(bars: Bar[], f: (i: number) => number | null): Nightly {
  const out: Nightly = new Map();
  bars.forEach((b, i) => {
    const v = f(i);
    if (v !== null && Number.isFinite(v)) out.set(b.day, v);
  });
  return out;
}

/** Wilder's RSI. Needs `period` returns before the first value. */
export function rsi(bars: Bar[], period = 14): Nightly {
  const out: Nightly = new Map();
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
      if (i < period) continue;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    out.set(bars[i].day, loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return out;
}

export const INDICATORS: Indicator[] = [
  {
    key: "abs-return",
    label: "Size of the day's move",
    why: "How far price closed from yesterday, up or down. A large move in either direction is news you take to bed.",
    compute: (bars) => {
      const r = logReturns(bars);
      return series(bars, (i) => (r[i] === null ? null : Math.abs(r[i]!)));
    },
  },
  {
    key: "return",
    label: "The day's return",
    why: "Signed: losing days and winning days kept apart, in case only one of them costs sleep.",
    compute: (bars) => {
      const r = logReturns(bars);
      return series(bars, (i) => r[i]);
    },
  },
  {
    key: "shock",
    label: "Surprise",
    why: "The move measured against the last 30 days. A 5% day in a calm month is a shock; in a wild month it is Tuesday. This is the one that tracks how unexpected the day felt.",
    compute: (bars) => {
      const r = logReturns(bars);
      return series(bars, (i) => {
        if (i <= BASELINE_DAYS || r[i] === null) return null;
        const base = r.slice(i - BASELINE_DAYS, i) as number[];
        const s = sd(base);
        return s > 0 ? Math.abs(r[i]!) / s : null;
      });
    },
  },
  {
    key: "range",
    label: "Intraday swing",
    why: "High to low within the day. A day that crashed and recovered closes flat but was not a flat day to watch.",
    compute: (bars) => series(bars, (i) => Math.log(bars[i].high / bars[i].low)),
  },
  {
    key: "drawdown",
    label: "Distance below the recent high",
    why: "How far under the best close of the last 30 days. Being down from a peak is a different, slower stress than one bad day.",
    compute: (bars) =>
      series(bars, (i) => {
        if (i < BASELINE_DAYS - 1) return null;
        const peak = Math.max(...bars.slice(i - BASELINE_DAYS + 1, i + 1).map((b) => b.close));
        return bars[i].close / peak - 1;
      }),
  },
  {
    key: "vol-7",
    label: "A rough week",
    why: "Volatility over the last seven days. Sustained turbulence, as opposed to a single day of it.",
    compute: (bars) => {
      const r = logReturns(bars);
      return series(bars, (i) => (i < 7 ? null : sd(r.slice(i - 6, i + 1) as number[])));
    },
  },
  {
    key: "rsi-extreme",
    label: "Euphoria or capitulation",
    why: "How far RSI(14) sits from neutral, either way. Near 100 or near 0 is when the market is loudest — the conditions for staying up to watch it.",
    compute: (bars) => {
      const out: Nightly = new Map();
      for (const [d, v] of rsi(bars)) out.set(d, Math.abs(v - 50));
      return out;
    },
  },
];

export const INDICATORS_BY_KEY = Object.fromEntries(INDICATORS.map((i) => [i.key, i]));

/**
 * Daily bars (SOL/USDT by default; BTC for the variance risk premium), no key.
 *
 * `data-api.binance.vision` is Binance's public market-data mirror; unlike
 * api.binance.com it does not refuse US addresses, which matters because the
 * server is on Render. This is the fallback. Pyth — Solana's own oracle, and
 * the source a judge expects — now wants an API key on both Benchmarks and
 * Hermes (401 on every endpoint as of 23 Sep 2026), and serves a point price
 * rather than a bar, so it gives the close but not the high and low `range`
 * needs.
 *
 * The series is not user data: fetch once a day, cache, serve to everybody.
 */
export async function fetchBars(symbol = "SOLUSDT", days = 400): Promise<Bar[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=${Math.min(days, 1000)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`price bars ${res.status}`);
  const rows = (await res.json()) as [number, string, string, string, string][];
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map(([t, o, h, l, c]) => ({
      day: new Date(t).toISOString().slice(0, 10),
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
    }))
    // Today's bar is still moving; it would be a different number tomorrow.
    .filter((b) => b.day < today);
}

/**
 * DVOL: crypto's VIX. Deribit's 30-day implied volatility index, annualised
 * percent, read off the options market — what traders are PAYING for protection
 * against the next month, as opposed to what the last week delivered.
 *
 * That difference is why it is here. Realised volatility is the market's
 * history; implied is its expectation, and the gap between them (the variance
 * risk premium) is priced fear. Coates and Herbert (PNAS 2008) found traders'
 * cortisol rose with market volatility, and Kandasamy et al. (PNAS 2014) that
 * cortisol raised for days shifts people toward safer choices. Whether a body
 * tracks the fear or the realised outcome is the non-obvious question.
 *
 * BTC and ETH only — Deribit publishes no SOL index, and no venue has a liquid
 * enough SOL options book for one. BTC's DVOL is the crypto-wide fear gauge;
 * SOL's own realised volatility sits next to it. Keyless; one call returns
 * over a year of daily bars.
 */
export async function fetchDvol(currency: "BTC" | "ETH" = "BTC", days = 400): Promise<Nightly> {
  const end = Date.now();
  const url =
    `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}` +
    `&start_timestamp=${end - days * 86_400_000}&end_timestamp=${end}&resolution=1D`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`DVOL ${res.status}`);
  const json = (await res.json()) as { result: { data: [number, number, number, number, number][] } };
  const today = new Date().toISOString().slice(0, 10);
  const out: Nightly = new Map();
  for (const [t, , , , close] of json.result.data) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day < today) out.set(day, close);
  }
  return out;
}

/**
 * The Crypto Fear & Greed Index (alternative.me): 0 is extreme fear, 100
 * extreme greed. Daily since February 2018, keyless.
 *
 * A third reading of the market's mood, and not an independent one. Per
 * alternative.me, it is Bitcoin only and weighted: realised volatility and
 * drawdowns 25%, momentum and volume 25%, social media 15%, surveys 15%,
 * dominance 10%, Google Trends 10%. So a quarter of it IS realised turbulence,
 * and it is never put beside realised volatility as if it were separate
 * evidence. Where it earns its place is direction: volatility rises in euphoric
 * spikes and in crashes alike, and this index tells the two apart.
 */
export async function fetchFearGreed(): Promise<Nightly> {
  const res = await fetch("https://api.alternative.me/fng/?limit=0", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`fear & greed ${res.status}`);
  const json = (await res.json()) as { data: { value: string; timestamp: string }[] };
  const out: Nightly = new Map();
  for (const d of json.data) out.set(new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10), Number(d.value));
  return out;
}
