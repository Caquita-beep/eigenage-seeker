/**
 * Candles at any interval, with volume, for the price chart.
 *
 * The engine's `fetchBars` serves Exposure: closed daily bars keyed by date,
 * no volume. A trading chart wants more — the candle still forming, intraday
 * intervals, volume — so this reads the same Binance endpoint directly and
 * keys by open time.
 */

export type Interval = "1m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface Candle {
  /** Open time, ms since epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Base-asset volume: SOL for SOLUSDT. */
  v: number;
}

const LIMIT: Record<Interval, number> = { "1m": 500, "15m": 500, "1h": 500, "4h": 500, "1d": 1000, "1w": 500 };
const cache = new Map<string, { at: number; candles: Candle[] }>();

export async function fetchCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  const k = `${symbol}:${interval}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 30_000) return hit.candles;
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${LIMIT[interval]}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`candles ${res.status}`);
  const rows = (await res.json()) as [number, string, string, string, string, string][];
  const candles = rows.map(([t, o, h, l, c, v]) => ({ t, o: +o, h: +h, l: +l, c: +c, v: +v }));
  cache.set(k, { at: Date.now(), candles });
  return candles;
}

/** Daily open time for a `YYYY-MM-DD` UTC date, to lay daily series on the same axis as candles. */
export const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
