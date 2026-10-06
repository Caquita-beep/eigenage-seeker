import type { Bar } from "./market";
import type { Nightly } from "./nights";

/**
 * Volatility, expected and delivered, on one scale: annualised percent.
 *
 * ── Our own index for SOL ─────────────────────────────────────────────────
 * No venue publishes a SOL volatility index. Deribit lists SOL options, quoted
 * in USDC, with two-sided markets on the weekly and monthly expiries, which is
 * enough to compute one the way the VIX is computed: the CBOE's variance-swap
 * replication, which prices the whole strip of out-of-the-money options rather
 * than reading one at-the-money implied vol, then interpolates to exactly 30
 * days. DVOL is built the same way, which is how this is checked: the same code
 * pointed at BTC options must land on DVOL.
 *
 * What it cannot have is a past. Deribit's public API serves the book as it is
 * now, not as it was, so the SOL index starts on the first day it was stored and
 * grows by one point a day. BTC's DVOL covers the history in the meantime.
 *
 * Rates are taken as zero. A USDC option's carry is a few percent a year, worth
 * a fraction of a vol point over 30 days — less than the bid-ask on one strike.
 */

export interface Quote {
  expiry: Date;
  strike: number;
  type: "C" | "P";
  bid: number;
  ask: number;
  /** The venue's implied vol for this strike, percent. Used only for delta. */
  iv?: number;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), ample for a 5% cut. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Black-76 delta magnitude. */
function absDelta(F: number, K: number, T: number, ivPct: number, type: "C" | "P"): number {
  const s = (ivPct / 100) * Math.sqrt(T);
  const d1 = (Math.log(F / K) + (s * s) / 2) / s;
  return type === "C" ? phi(d1) : 1 - phi(d1);
}

/**
 * DVOL's wing cut: options under 5% delta are dropped. Deribit's minimum tick
 * keeps a bid on even the most hopeless strike, so the CBOE rule of stopping at
 * two zero bids never fires there, and those floor-priced wings add variance
 * nobody is really paying for. Measured on BTC, 24 Sep 2026: without the cut
 * this code read 38.0 against DVOL's 35.8; with it, 35.76 against 35.79.
 */
const MIN_DELTA = 0.05;

const MINUTES_YEAR = 365 * 24 * 60;
const MINUTES_30D = 30 * 24 * 60;

/** Deribit option names: `SOL_USDC-9OCT26-120-C`, `BTC-26DEC26-100000-P`. Expiry 08:00 UTC. */
export function parseInstrument(name: string): { expiry: Date; strike: number; type: "C" | "P" } | null {
  const m = /-(\d{1,2})([A-Z]{3})(\d{2})-([\dd.]+)-([CP])$/.exec(name);
  if (!m) return null;
  const months = "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC";
  const mon = months.indexOf(m[2]) / 3;
  if (mon < 0 || mon % 1) return null;
  const strike = Number(m[4].replace("d", "."));
  return { expiry: new Date(Date.UTC(2000 + Number(m[3]), mon, Number(m[1]), 8)), strike, type: m[5] as "C" | "P" };
}

/** One expiry's variance, CBOE white paper, eq. 2. Null when the strip is too thin. */
export function termVariance(quotes: Quote[], now: Date): { T: number; variance: number } | null {
  const T = (quotes[0].expiry.getTime() - now.getTime()) / 60000 / MINUTES_YEAR;
  if (T <= 0) return null;
  const mid = (q: Quote) => (q.bid + q.ask) / 2;
  const strikes = [...new Set(quotes.map((q) => q.strike))].sort((a, b) => a - b);
  const call = new Map(quotes.filter((q) => q.type === "C").map((q) => [q.strike, q]));
  const put = new Map(quotes.filter((q) => q.type === "P").map((q) => [q.strike, q]));

  // Forward from put-call parity at the strike where call and put are closest.
  let kStar: number | null = null;
  let gap = Infinity;
  for (const k of strikes) {
    const c = call.get(k), p = put.get(k);
    if (!c || !p || c.bid <= 0 || p.bid <= 0) continue;
    const g = Math.abs(mid(c) - mid(p));
    if (g < gap) { gap = g; kStar = k; }
  }
  if (kStar === null) return null;
  const F = kStar + mid(call.get(kStar)!) - mid(put.get(kStar)!);
  const below = strikes.filter((k) => k <= F);
  if (!below.length) return null;
  const K0 = below[below.length - 1];

  // Out-of-the-money strip outward from K0, stopping after two zero bids.
  const used: { k: number; q: number }[] = [];
  const walk = (ks: number[], side: Map<number, Quote>) => {
    let zeros = 0;
    for (const k of ks) {
      const o = side.get(k);
      if (o?.iv && absDelta(F, k, T, o.iv, o.type) < MIN_DELTA) break;
      if (!o || o.bid <= 0) {
        if (++zeros >= 2) break;
        continue;
      }
      zeros = 0;
      used.push({ k, q: mid(o) });
    }
  };
  walk(strikes.filter((k) => k < K0).reverse(), put);
  walk(strikes.filter((k) => k > K0), call);
  const c0 = call.get(K0), p0 = put.get(K0);
  if (!c0 || !p0) return null;
  used.push({ k: K0, q: (mid(c0) + mid(p0)) / 2 });
  used.sort((a, b) => a.k - b.k);
  if (used.length < 5) return null;

  let sum = 0;
  used.forEach(({ k, q }, i) => {
    const dK = i === 0 ? used[1].k - k : i === used.length - 1 ? k - used[i - 1].k : (used[i + 1].k - used[i - 1].k) / 2;
    sum += (dK / (k * k)) * q;
  });
  const variance = (2 / T) * sum - (1 / T) * (F / K0 - 1) ** 2;
  return variance > 0 ? { T, variance } : null;
}

/**
 * The 30-day index: the two expiries either side of 30 days, interpolated in
 * total variance (CBOE eq. 3). The near one must be at least 7 days out — the
 * last week of an option's life is dominated by pin risk, not by expectation.
 */
export function volIndex(quotes: Quote[], now: Date): { value: number; near: Date; next: Date } | null {
  const byExpiry = new Map<number, Quote[]>();
  for (const q of quotes) {
    const t = q.expiry.getTime();
    if (!byExpiry.has(t)) byExpiry.set(t, []);
    byExpiry.get(t)!.push(q);
  }
  const minutes = (t: number) => (t - now.getTime()) / 60000;
  const expiries = [...byExpiry.keys()].filter((t) => minutes(t) >= 7 * 1440).sort((a, b) => a - b);
  const near = expiries.filter((t) => minutes(t) <= MINUTES_30D).at(-1);
  const next = expiries.find((t) => minutes(t) > MINUTES_30D);
  if (near === undefined || next === undefined) return null;
  const a = termVariance(byExpiry.get(near)!, now);
  const b = termVariance(byExpiry.get(next)!, now);
  if (!a || !b) return null;
  const n1 = minutes(near), n2 = minutes(next);
  const w1 = (n2 - MINUTES_30D) / (n2 - n1);
  const w2 = (MINUTES_30D - n1) / (n2 - n1);
  const v30 = (a.T * a.variance * w1 + b.T * b.variance * w2) * (MINUTES_YEAR / MINUTES_30D);
  return { value: 100 * Math.sqrt(v30), near: new Date(near), next: new Date(next) };
}

/**
 * The live book from Deribit. SOL options are USDC-linear, quoted in dollars;
 * BTC options are inverse, quoted in BTC, and converted at each quote's own
 * underlying price so the arithmetic above sees dollars either way.
 */
export async function fetchOptionQuotes(asset: "SOL" | "BTC"): Promise<Quote[]> {
  const currency = asset === "SOL" ? "USDC" : "BTC";
  const res = await fetch(
    `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`Deribit ${res.status}`);
  const rows = (await res.json()).result as {
    instrument_name: string;
    bid_price: number | null;
    ask_price: number | null;
    underlying_price: number;
    mark_iv: number | null;
  }[];
  const prefix = asset === "SOL" ? "SOL_USDC-" : "BTC-";
  const out: Quote[] = [];
  for (const r of rows) {
    if (!r.instrument_name.startsWith(prefix)) continue;
    const p = parseInstrument(r.instrument_name);
    if (!p || r.bid_price === null || r.ask_price === null || r.ask_price <= 0) continue;
    const scale = asset === "BTC" ? r.underlying_price : 1;
    out.push({ ...p, bid: r.bid_price * scale, ask: r.ask_price * scale, iv: r.mark_iv ?? undefined });
  }
  return out;
}

/**
 * Realised volatility from daily highs and lows (Parkinson 1980), trailing
 * `days`, annualised percent.
 *
 * The high-low range carries about five times the information of the close
 * alone, so 30 days of ranges measure delivered volatility about as well as
 * 150 days of closes. That matters for the question this feeds: comparing a
 * clean expected-volatility series against a noisy realised one would bias the
 * answer toward "the body follows expectation" through measurement error alone.
 */
export function parkinson(bars: Bar[], days = 30): Nightly {
  const out: Nightly = new Map();
  const k = 1 / (4 * Math.log(2));
  for (let i = days - 1; i < bars.length; i++) {
    let s = 0;
    for (let j = i - days + 1; j <= i; j++) s += Math.log(bars[j].high / bars[j].low) ** 2;
    out.set(bars[i].day, 100 * Math.sqrt((k * s) / days) * Math.sqrt(365));
  }
  return out;
}
