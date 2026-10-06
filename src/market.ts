import AsyncStorage from "@react-native-async-storage/async-storage";
import { banded, type Position } from "./engine/hrv";
import { fetchBars, fetchDvol, fetchFearGreed, type Bar } from "./engine/market";
import type { Nightly } from "./engine/nights";
import { fetchOptionQuotes, parkinson, volIndex } from "./engine/vol";
import { weeklyMean } from "./engine/weeks";

/**
 * The market side of Exposure, computed on the phone.
 *
 * The website does this on the server (`snapshot.ts`) and caches it for
 * everybody. Here every source is a keyless public API, so the phone asks them
 * directly and needs no server at all. Each source fails on its own: Binance's
 * mirror, Deribit and alternative.me are three companies' uptime, and one
 * being down leaves a null the screen shows as unavailable.
 *
 * Deribit keeps no history of its options book, so the SOL index only has a
 * past if somebody records it. The server records it in Postgres; the phone
 * records its own copy, one value per day it is opened.
 */

export type Point = [day: string, value: number];

export interface MarketView {
  asOf: string;
  sol: { price: number; day: string; change1d: number | null; change7d: number | null } | null;
  /** Daily SOL/USDT bars, up to 1000 days: the price chart and every indicator on it. */
  solBars: Bar[];
  /** Daily BTC/USDT bars: BTC's realised volatility, raced against its own DVOL. */
  btcBars: Bar[];
  solIndex: { value: number; near: string; next: string } | null;
  solIndexHistory: Point[];
  dvol: { value: number; position: Position; low: number; high: number } | null;
  /** DVOL, full history, with its 60-day band where one exists. */
  dvolSeries: { day: string; value: number; low: number | null; high: number | null }[];
  solRealised: number | null;
  btcRealised: number | null;
  /** Parkinson 30-day realised volatility, full history. */
  solRealisedSeries: Point[];
  btcRealisedSeries: Point[];
  /** DVOL minus BTC's realised volatility: priced fear. */
  premium: number | null;
  fng: { value: number; day: string } | null;
  fngSeries: Point[];
  weeks: { week: string; expected: number; realised: number }[];
  overlap: number | null;
}

const VIEW_KEY = "market:view:v3";
const INDEX_KEY = "market:sol-vol-30d";
const FRESH_MS = 60 * 60 * 1000;

const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
const points = (m: Nightly): Point[] => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/** The last view computed, if any, and whether it is still fresh. */
export async function cachedMarket(): Promise<{ view: MarketView; fresh: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const view = JSON.parse(raw) as MarketView;
    return { view, fresh: Date.now() - Date.parse(view.asOf) < FRESH_MS };
  } catch {
    return null;
  }
}

export async function loadMarket(): Promise<MarketView> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [solBars, btcBars, dvol, fng, solQuotes] = await Promise.all([
    settle(fetchBars("SOLUSDT", 1000)),
    settle(fetchBars("BTCUSDT", 1000)),
    settle(fetchDvol("BTC", 1000)),
    settle(fetchFearGreed()),
    settle(fetchOptionQuotes("SOL")),
  ]);

  const idx = solQuotes ? volIndex(solQuotes, now) : null;
  const solIndexHistory = await recordAndRead(today, idx?.value ?? null);

  const solRv = solBars ? parkinson(solBars) : null;
  const btcRv = btcBars ? parkinson(btcBars) : null;
  const last = (m: Nightly | null) => (m && m.size ? [...m.values()].at(-1)! : null);

  const band = dvol ? banded(dvol) : null;
  let dvolNow: MarketView["dvol"] = null;
  if (dvol && band) {
    const b = [...band.values()].at(-1);
    if (b) dvolNow = { value: last(dvol)!, position: b.position, low: b.low, high: b.high };
  }
  const dvolSeries = dvol
    ? points(dvol).map(([day, value]) => {
        const b = band?.get(day);
        return { day, value, low: b?.low ?? null, high: b?.high ?? null };
      })
    : [];

  const weeks: MarketView["weeks"] = [];
  if (dvol && btcRv) {
    const e = weeklyMean(dvol);
    const r = weeklyMean(btcRv);
    for (const [week, expected] of e) {
      const realised = r.get(week);
      if (realised !== undefined) weeks.push({ week, expected, realised });
    }
    weeks.sort((a, b) => (a.week < b.week ? -1 : 1));
    weeks.splice(0, Math.max(0, weeks.length - 52));
  }

  const premiumDay = dvol ? [...dvol.keys()].at(-1) : undefined;
  const premium =
    premiumDay && btcRv?.has(premiumDay) ? dvol!.get(premiumDay)! - btcRv.get(premiumDay)! : null;

  const fngPoints = fng ? points(fng) : [];
  const fngLast = fngPoints.at(-1);

  const view: MarketView = {
    asOf: now.toISOString(),
    sol: solBars?.length ? solSummary(solBars) : null,
    solBars: solBars ?? [],
    btcBars: btcBars ?? [],
    solIndex: idx
      ? { value: idx.value, near: idx.near.toISOString().slice(0, 10), next: idx.next.toISOString().slice(0, 10) }
      : null,
    solIndexHistory,
    dvol: dvolNow,
    dvolSeries,
    solRealised: last(solRv),
    btcRealised: last(btcRv),
    solRealisedSeries: solRv ? points(solRv) : [],
    btcRealisedSeries: btcRv ? points(btcRv) : [],
    premium,
    fng: fngLast ? { day: fngLast[0], value: fngLast[1] } : null,
    fngSeries: fngPoints,
    weeks,
    overlap: correlation(weeks.map((w) => w.expected), weeks.map((w) => w.realised)),
  };
  AsyncStorage.setItem(VIEW_KEY, JSON.stringify(view)).catch(() => {});
  return view;
}

function solSummary(bars: Bar[]): NonNullable<MarketView["sol"]> {
  const last = bars[bars.length - 1];
  const back = (n: number) => bars[bars.length - 1 - n]?.close;
  const pct = (then?: number) => (then ? (last.close / then - 1) * 100 : null);
  return { price: last.close, day: last.day, change1d: pct(back(1)), change7d: pct(back(7)) };
}

async function recordAndRead(day: string, value: number | null): Promise<Point[]> {
  let history: Point[] = [];
  try {
    history = JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? "[]");
  } catch {}
  if (value !== null && !history.some(([d]) => d === day)) {
    history = [...history, [day, value] as Point].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    AsyncStorage.setItem(INDEX_KEY, JSON.stringify(history)).catch(() => {});
  }
  return history;
}

function correlation(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
