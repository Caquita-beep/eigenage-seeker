import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchCandles, type Candle } from "./candles";
import type { Nightly } from "./engine/nights";
import { SOL, STABLE_MINTS, WSOL_MINT } from "./engine/wallet";

/**
 * Prices for the coins a wallet holds — any Solana token, not only the ones
 * an exchange lists.
 *
 *   history   GeckoTerminal's public API: OHLCV candles for a token from its
 *             deepest DEX pool, priced in USD, at 15 minutes, 1 hour, 4 hours
 *             or 1 day. Keyless, but slow (1 to 4 seconds a call) and quick to
 *             refuse a burst, so its calls go out one at a time (`gecko`), the
 *             pool behind each token is looked up once and kept, and every
 *             frame's candles are kept on the phone: a chart opens on what is
 *             there and refreshes behind it (`watchCoinCandles`).
 *   now       DexScreener's token endpoint: price and 24-hour change for up
 *             to 30 tokens in one call, from each token's most liquid pair.
 *
 * SOL is read from Binance first, as the price chart always has been, and
 * from GeckoTerminal's SOL pools when Binance cannot be reached — which it
 * cannot from networks whose resolver refuses its hostname.
 */

export interface Coin {
  mint: string;
  symbol: string;
  name: string;
  /** Its logo, from CoinGecko's image CDN (the one GeckoTerminal links), or null if it has none. */
  image: string | null;
}

export const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const CG = "https://coin-images.coingecko.com/coins/images";
const IMAGE: Record<string, string> = {
  [SOL]: `${CG}/21629/large/solana.jpg`,
  [JUP_MINT]: `${CG}/34188/large/jup.png`,
  [BONK_MINT]: `${CG}/28600/large/bonk.jpg`,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: `${CG}/6319/large/USDC.png`,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: `${CG}/325/large/Tether.png`,
};

const KNOWN: Record<string, Coin> = {
  [SOL]: { mint: SOL, symbol: "SOL", name: "Solana", image: IMAGE[SOL] },
  [JUP_MINT]: { mint: JUP_MINT, symbol: "JUP", name: "Jupiter", image: IMAGE[JUP_MINT] },
  [BONK_MINT]: { mint: BONK_MINT, symbol: "BONK", name: "Bonk", image: IMAGE[BONK_MINT] },
  ...Object.fromEntries(Object.entries(STABLE_MINTS).map(([mint, symbol]) => [mint, { mint, symbol, name: symbol, image: IMAGE[mint] ?? null }])),
};

export const isStable = (mint: string) => !!STABLE_MINTS[mint];

/** The mint the price sources know a coin by: wrapped SOL for SOL. */
const sourceMint = (mint: string) => (mint === SOL ? WSOL_MINT : mint);

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

class Busy extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
  if (res.status === 429) throw new Busy("The price service is busy. Try again in a minute.");
  if (!res.ok) throw new Error(`price service ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * GeckoTerminal, one call at a time. It refuses a burst (a 429 after about
 * five quick calls), and a chart, its header and a prefetch can all want it at
 * once. Calls wait their turn with a short gap between them; the chart on
 * screen goes ahead of prefetching; a refusal is retried after a pause before
 * it is reported.
 */
const GAP_MS = 1200;
type Job = { path: string; urgent: boolean; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const jobs: Job[] = [];
let pumping = false;

function gecko<T>(path: string, urgent = true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = { path, urgent, resolve: resolve as (v: unknown) => void, reject };
    const at = urgent ? jobs.findIndex((j) => !j.urgent) : -1;
    if (at === -1) jobs.push(job);
    else jobs.splice(at, 0, job);
    void pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (jobs.length) {
    const job = jobs.shift()!;
    for (let attempt = 0; ; attempt++) {
      try {
        job.resolve(await getJson(`${GT}${job.path}`));
        break;
      } catch (e) {
        if (e instanceof Busy && attempt < 2) {
          await sleep(5000 * (attempt + 1));
          continue;
        }
        job.reject(e);
        break;
      }
    }
    await sleep(GAP_MS);
  }
  pumping = false;
}

async function stored<T>(key: string, maxAgeMs: number, make: () => Promise<T>): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const hit = JSON.parse(raw) as { at: number; v: T };
      if (Date.now() - hit.at < maxAgeMs) return hit.v;
    }
  } catch {}
  const v = await make();
  AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), v })).catch(() => {});
  return v;
}

/** Symbol, name and logo. Known coins without a call; anything else from GeckoTerminal, kept for a month. */
export async function coinInfo(mint: string): Promise<Coin> {
  if (KNOWN[mint]) return KNOWN[mint];
  return stored(`coin:info:v2:${mint}`, 30 * 86_400_000, async () => {
    const j = await gecko<{ data: { attributes: { symbol: string; name: string; image_url: string | null } } }>(`/tokens/${mint}`, false);
    const { symbol, name, image_url } = j.data.attributes;
    // A token without a logo has "missing.png" here.
    return { mint, symbol, name, image: image_url?.startsWith("https://") ? image_url : null };
  });
}

export const knownCoin = (mint: string): Coin | null => KNOWN[mint] ?? null;

/** The token's deepest pool, kept for a week: liquidity moves, but not daily. */
async function topPool(mint: string, urgent: boolean): Promise<string> {
  return stored(`coin:pool:${mint}`, 7 * 86_400_000, async () => {
    const j = await gecko<{ data: { attributes: { address: string } }[] }>(`/tokens/${sourceMint(mint)}/pools?page=1`, urgent);
    if (!j.data.length) throw new Error("No market for this coin yet.");
    return j.data[0].attributes.address;
  });
}

export type CoinFrame = "15m" | "1h" | "4h" | "1d";

const GT_FRAME: Record<CoinFrame, string> = { "15m": "minute?aggregate=15", "1h": "hour?aggregate=1", "4h": "hour?aggregate=4", "1d": "day?aggregate=1" };

async function geckoCandles(mint: string, frame: CoinFrame, urgent: boolean): Promise<Candle[]> {
  const pool = await topPool(mint, urgent);
  const j = await gecko<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(
    `/pools/${pool}/ohlcv/${GT_FRAME[frame]}&limit=1000&currency=usd&token=${sourceMint(mint)}`,
    urgent,
  );
  return j.data.attributes.ohlcv_list
    .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

/** How long a frame's candles count as current: about a bar's worth of change. */
const FRESH_MS: Record<CoinFrame, number> = { "15m": 60_000, "1h": 5 * 60_000, "4h": 15 * 60_000, "1d": 6 * 3_600_000 };
/** Intraday candles kept on the phone per coin and frame: enough for the chart's 300 and the 99-period average before them. */
const KEEP = 600;

type Kept = { at: number; candles: Candle[] };
const memo = new Map<string, Kept>();
const inflight = new Map<string, Promise<Candle[]>>();
const keyOf = (mint: string, frame: CoinFrame) => `coin:candles:${frame}:${mint}`;

/** What the phone has for this coin and frame, of any age. */
async function kept(mint: string, frame: CoinFrame): Promise<Kept | null> {
  const k = keyOf(mint, frame);
  const hit = memo.get(k);
  if (hit) return hit;
  try {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) return null;
    const v = JSON.parse(raw) as Kept;
    memo.set(k, v);
    return v;
  } catch {
    return null;
  }
}

const isFresh = (k: Kept | null, frame: CoinFrame): boolean => !!k && Date.now() - k.at < FRESH_MS[frame];

/** The latest candles from the network, kept for next time. One request per coin and frame at a time. */
function latest(mint: string, frame: CoinFrame, urgent: boolean): Promise<Candle[]> {
  const k = keyOf(mint, frame);
  const running = inflight.get(k);
  if (running) return running;
  const p = (async () => {
    let candles: Candle[] | null = null;
    if (mint === SOL) {
      try {
        candles = await fetchCandles("SOLUSDT", frame);
      } catch {
        // Binance unreachable: the same price from SOL's own pools.
      }
    }
    candles ??= await geckoCandles(mint, frame, urgent);
    const v: Kept = { at: Date.now(), candles: frame === "1d" ? candles : candles.slice(-KEEP) };
    memo.set(k, v);
    AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});
    return v.candles;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/**
 * Candles, oldest first, priced in USD: what the phone has if it is current,
 * else the latest, else (when the network fails) what the phone has of any age.
 */
export async function fetchCoinCandles(mint: string, frame: CoinFrame, urgent = true): Promise<Candle[]> {
  const hit = await kept(mint, frame);
  if (hit && isFresh(hit, frame)) return hit.candles;
  try {
    return await latest(mint, frame, urgent);
  } catch (e) {
    if (hit) return hit.candles;
    throw e;
  }
}

/**
 * For a chart: what the phone has, at once, then the latest if that was
 * stale. `on` may be called twice. An error is reported only when there is
 * nothing to show. Returns a function that stops further calls.
 */
export function watchCoinCandles(mint: string, frame: CoinFrame, on: (c: Candle[]) => void, onError: (e: unknown) => void): () => void {
  let live = true;
  (async () => {
    const hit = await kept(mint, frame);
    if (hit && live) on(hit.candles);
    if (isFresh(hit, frame)) return;
    try {
      const c = await latest(mint, frame, true);
      if (live) on(c);
    } catch (e) {
      if (live && !hit) onError(e);
    }
  })();
  return () => {
    live = false;
  };
}

/** Warm a coin's chart in the background, behind anything on screen. */
export function prefetchCoin(mint: string, frame: CoinFrame): void {
  fetchCoinCandles(mint, frame, false).catch(() => {});
}

/** Daily closes by UTC date, for pricing trades. */
export async function dailyCloses(mint: string): Promise<Nightly> {
  const c = await fetchCoinCandles(mint, "1d");
  return new Map(c.map((x) => [new Date(x.t).toISOString().slice(0, 10), x.c]));
}

export interface Quote {
  price: number;
  change24h: number | null;
}

const quoteMemo = new Map<string, { at: number; q: Quote }>();

/** A quote fetched in the last minute, if any: the coin list's quote opens the coin's chart. */
export const recentQuote = (mint: string): Quote | null => {
  const hit = quoteMemo.get(mint);
  return hit && Date.now() - hit.at < 60_000 ? hit.q : null;
};

/** Price and 24-hour change for each mint, from its most liquid pair. Stablecoins are a dollar. Each is kept for a minute. */
export async function fetchQuotes(mints: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = Object.fromEntries(mints.filter(isStable).map((m) => [m, { price: 1, change24h: 0 }]));
  for (const m of mints) {
    const q = recentQuote(m);
    if (q) out[m] = q;
  }
  const want = [...new Set(mints.filter((m) => !isStable(m) && !out[m]))].slice(0, 30);
  if (want.length) {
    const pairs = await getJson<{ baseToken: { address: string }; priceUsd?: string; priceChange?: { h24?: number }; liquidity?: { usd?: number } }[]>(
      `https://api.dexscreener.com/tokens/v1/solana/${want.map(sourceMint).join(",")}`,
    );
    const best = new Map<string, (typeof pairs)[number]>();
    for (const p of pairs) {
      const cur = best.get(p.baseToken.address);
      if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(p.baseToken.address, p);
    }
    for (const m of want) {
      const p = best.get(sourceMint(m));
      if (!p?.priceUsd) continue;
      out[m] = { price: Number(p.priceUsd), change24h: p.priceChange?.h24 ?? null };
      quoteMemo.set(m, { at: Date.now(), q: out[m] });
    }
  }
  return out;
}
