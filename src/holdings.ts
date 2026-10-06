import { useEffect, useState } from "react";
import { coinInfo, fetchQuotes, isStable, knownCoin, prefetchCoin, type Coin, type CoinFrame, type Quote } from "./coins";
import { averageCost, water } from "./engine/cost";
import { SOL } from "./engine/wallet";
import { getPref } from "./prefs";
import type { WalletView } from "./walletview";

/**
 * The wallet's coins priced, once for the app (`data.tsx`): the balance, its
 * ring and the coin lists all read these rows, so they always add up.
 */

/**
 * The allocation ring's colours (`yourcoins.tsx`): one hue, the wallet's
 * amber (`theme.ts`), stepped from light to dark by size, so the ring reads
 * as the wallet's and its largest coin stands out first. A ramp, not a set of
 * hues: each step is about 0.13 darker in OKLab lightness than the one before,
 * which colour blindness leaves intact, and the ring adds a gap between
 * segments and the coin list each coin's share beside its swatch. A fifth coin
 * and beyond are Other, in the app's neutral grey.
 */
export const SLOTS = ["#FABD7F", "#CF8F4A", "#9C672D", "#6F4513"];
export const OTHER = "#8B919C";
/** Below this share of the balance a coin is too thin to see in the ring, and joins Other. */
const MIN_SHARE = 0.02;

export interface CoinRow {
  mint: string;
  amount: number;
  symbol: string;
  image: string | null;
  q: Quote | undefined;
  /** What it is worth now, in dollars; null until it has a price. */
  value: number | null;
  avg: number | null;
  w: ReturnType<typeof water> | null;
  covered: number;
  /** Its share of the balance, once priced. */
  share: number | null;
  /** Its colour in the ring: its step by size, or Other's grey. */
  tint: string;
}

export interface Coins {
  /** Largest first. Empty without a wallet or holdings. */
  rows: CoinRow[];
  /** True once the prices are in, so a total is a total. */
  priced: boolean;
  error: string | null;
}

/**
 * The wallet's coins, priced: one fetch, read by both the balance and the
 * coin list, so the two always add up.
 */
export function useCoins(wallet: WalletView | null): Coins {
  const holdings = wallet?.holdings ?? [];
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(null);
  const [coins, setCoins] = useState<Record<string, Coin>>({});
  const [error, setError] = useState<string | null>(null);
  const key = holdings.map((h) => h.mint).sort().join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    const mints = key.split(",");
    fetchQuotes(mints)
      .then((q) => live && setQuotes(q))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    // Warm each coin's chart at the timeframe it last showed, so a tap opens it at once.
    for (const m of mints) {
      if (isStable(m)) continue;
      const frame = getPref<string>(m === SOL ? "price:sol:frame" : `price:${m}:frame`, "1d");
      if (frame === "15m" || frame === "1h" || frame === "4h" || frame === "1d") prefetchCoin(m, frame as CoinFrame);
    }
    for (const m of mints) {
      if (knownCoin(m)) continue;
      coinInfo(m)
        .then((c) => live && setCoins((prev) => ({ ...prev, [m]: c })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [key]);

  if (!wallet || !holdings.length) return { rows: [], priced: false, error };
  const rows = holdings
    .map((h): CoinRow => {
      const q = quotes?.[h.mint];
      const pos = wallet.cost?.now.find((p) => p.mint === h.mint) ?? null;
      const avg = pos ? averageCost(pos) : null;
      const w = pos && q ? water(pos, q.price) : null;
      // Share of the holding whose cost is known: the rest came in without a price.
      const covered = pos && pos.amount > 0 ? pos.costed / pos.amount : 0;
      const coin = knownCoin(h.mint) ?? coins[h.mint];
      return { ...h, symbol: coin?.symbol ?? `${h.mint.slice(0, 4)}…`, image: coin?.image ?? null, q, value: q ? q.price * h.amount : null, avg, w, covered, share: null, tint: OTHER };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  // The largest coins get a step each, in order of size: the lightest is the largest.
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const named = rows
    .filter((r) => total > 0 && (r.value ?? 0) / total >= MIN_SHARE)
    .slice(0, SLOTS.length)
    .map((r) => r.mint);
  for (const r of rows) {
    r.share = total > 0 && r.value !== null ? r.value / total : null;
    r.tint = named.includes(r.mint) ? SLOTS[named.indexOf(r.mint)] : OTHER;
  }
  return { rows, priced: quotes !== null, error };
}

/**
 * What the coins are worth together, and how that moved over the last 24
 * hours: each coin's value then is its value now less its 24-hour change.
 * Stablecoins are a dollar either way. Null until the prices are in.
 */
export interface Balance {
  total: number;
  /** Dollars, over the last 24 hours. */
  change: number;
  pct: number | null;
}

export const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "+$312.40 · +1.54% 24h". */
export const changeLine = (b: Balance) => {
  const sign = b.change >= 0 ? "+" : "−";
  return `${sign}${money(Math.abs(b.change))} · ${sign}${Math.abs(b.pct ?? 0).toFixed(2)}% 24h`;
};

export function balanceOf({ rows, priced }: Coins): Balance | null {
  if (!priced || !rows.length) return null;
  let total = 0;
  let before = 0;
  for (const r of rows) {
    if (r.value === null) continue;
    total += r.value;
    const ch = isStable(r.mint) ? 0 : (r.q?.change24h ?? 0);
    before += r.value / (1 + ch / 100);
  }
  return { total, change: total - before, pct: before > 0 ? (100 * (total - before)) / before : null };
}
