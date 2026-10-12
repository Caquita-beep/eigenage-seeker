import { positions, type Position as CostPosition } from "./engine/cost";
import { banded, type Position } from "./engine/hrv";
import { addDays, nightOf, type Nightly } from "./engine/nights";
import { SOL, STABLE_MINTS, walletNights, type WalletAct } from "./engine/wallet";

/**
 * The wallet view, built from valued acts. No storage and no network, so it
 * runs anywhere — on the phone for the chain and the synthetic trader alike,
 * and in Node to check what the screens will say.
 */

export type Point = [night: string, value: number];

export interface WalletView {
  /**
   * `synthetic` is a generated trader (`engine/synthetic-wallet.ts`), not a
   * wallet on chain. Every screen that shows it says so. Absent on views
   * cached before synthetic wallets existed, which were all from the chain.
   */
  source?: "chain" | "synthetic";
  /** The wallet's address, or a group's key (`wallets.ts`) when several are read together. */
  address: string;
  /** The wallets a combined view adds up; absent on a single wallet's. */
  members?: string[];
  asOf: string;
  /** False when the wallet was busier than the read limit and the window starts later than asked. */
  complete: boolean;
  first: string;
  last: string;
  acts: number;
  /**
   * One entry per night. `value` is the trading load: summed share of liquid
   * holdings swapped. The rest are the other nightly counts, for the chart.
   */
  load: {
    night: string;
    value: number;
    low: number | null;
    high: number | null;
    swaps: number;
    usd: number;
    late: number;
    count: number;
    /** 1 if anything was signed between midnight and 05:00. */
    awake: number;
    failed: number;
  }[];
  /** Where the last 7 nights' load sits against the wallet's own 60-night normal. */
  loadNow: { baseline: number; low: number; high: number; position: Position } | null;
  last30: { awakeNights: number; lateActs: number; swaps: number; usd: number; failed: number };
  /** Local clock time of each signed act in the last 30 nights, minutes past 18:00. */
  clock: number[];
  /**
   * The last 30 days by the hour, on the reader's own clock: every hour, quiet
   * ones as real zeros, so an hourly chart's time axis has no holes. `share`
   * is the trading load within the hour. Absent on views cached before it
   * existed.
   */
  hours?: HourBucket[];
  /** Every successful swap in the window, oldest first: what the charts mark. Absent on older cached views. */
  trades?: Trade[];
  /**
   * Each coin's balance after the last transaction that touched it. Only coins
   * the wallet moved in the window are known this way; one held untouched for
   * longer is not seen. Absent on older cached views.
   */
  holdings?: Holding[];
  /**
   * What each coin cost on average, from both sides of every swap
   * (`engine/cost.ts`): now, and at the end of each night that had a
   * transaction, for the underwater series. Absent on older cached views.
   */
  cost?: { now: CostPosition[]; byNight: [string, CostPosition[]][] };
}

export interface Trade {
  /** Block time, ms since epoch. */
  t: number;
  /** The coin traded: the side that is neither a stablecoin nor SOL, else SOL. */
  mint: string;
  side: "buy" | "sell";
  amount: number;
  usd: number | null;
}

export interface Holding {
  mint: string;
  amount: number;
}

/** The coin a swap was about, and which way. */
function tradeOf(a: WalletAct): Trade | null {
  if (a.kind !== "swap" || a.failed || !a.legs) return null;
  const moved = a.legs.filter((l) => l.delta !== 0);
  const coin = moved.find((l) => l.mint !== SOL && !STABLE_MINTS[l.mint]) ?? moved.find((l) => l.mint === SOL);
  if (!coin) return null;
  return { t: a.blockTime * 1000, mint: coin.mint, side: coin.delta > 0 ? "buy" : "sell", amount: Math.abs(coin.delta), usd: a.usd ?? null };
}

function holdingsOf(acts: WalletAct[]): Holding[] {
  const bal = new Map<string, number>();
  for (const a of [...acts].sort((x, y) => x.blockTime - y.blockTime)) for (const l of a.legs ?? []) bal.set(l.mint, l.pre + l.delta);
  return [...bal.entries()].filter(([, v]) => v > 1e-9).map(([mint, amount]) => ({ mint, amount }));
}

export interface HourBucket {
  /** Start of the hour, ms since epoch. */
  t: number;
  count: number;
  swaps: number;
  usd: number;
  share: number;
  failed: number;
}

const HOUR = 3600;
const HOURS_KEPT = 30 * 24;

/** Each signed act counted into its local hour, over the last 30 days. */
function hourly(acts: WalletAct[], offset: number, now: Date): HourBucket[] {
  const localHour = (unix: number) => Math.floor((unix + offset * 60) / HOUR) * HOUR - offset * 60;
  const end = localHour(Math.floor(now.getTime() / 1000));
  const start = end - (HOURS_KEPT - 1) * HOUR;
  const out: HourBucket[] = Array.from({ length: HOURS_KEPT }, (_, i) => ({ t: (start + i * HOUR) * 1000, count: 0, swaps: 0, usd: 0, share: 0, failed: 0 }));
  for (const a of acts) {
    const h = localHour(a.blockTime);
    if (h < start || h > end) continue;
    const e = out[(h - start) / HOUR];
    e.count++;
    if (a.failed) e.failed++;
    if (a.kind === "swap" && !a.failed) {
      e.swaps++;
      e.usd += a.usd ?? 0;
      e.share += a.share ?? 0;
    }
  }
  return out;
}

const sum = (m: Nightly, from: string) => [...m.entries()].reduce((s, [k, v]) => (k >= from ? s + v : s), 0);

/**
 * Everything after the acts are valued, shared by the chain and the synthetic
 * trader so the two cannot be read differently.
 */
export function buildView(o: {
  source: "chain" | "synthetic";
  address: string;
  now: Date;
  offset: number;
  acts: WalletAct[];
  complete: boolean;
  first: string;
  last: string;
  /**
   * A combined view's wallets, each with its own acts. Balances are per
   * wallet — a leg's `pre` is that wallet's — so holdings and cost are read
   * wallet by wallet and added up, never from the merged acts.
   */
  parts?: { address: string; acts: WalletAct[] }[];
}): WalletView {
  const { source, address, now, offset, acts, complete, first, last, parts } = o;
  const nights = walletNights(acts, offset, first, last);

  const band = banded(nights.share);
  const load = [...nights.share.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([night, value]) => {
      const b = band.get(night);
      return {
        night,
        value,
        low: b?.low ?? null,
        high: b?.high ?? null,
        swaps: nights.swaps.get(night) ?? 0,
        usd: nights.usd.get(night) ?? 0,
        late: nights.late.get(night) ?? 0,
        count: nights.count.get(night) ?? 0,
        awake: nights.awake.get(night) ?? 0,
        failed: nights.failed.get(night) ?? 0,
      };
    });
  const loadNow = [...band.values()].at(-1) ?? null;

  const from30 = addDays(last, -29);
  const clock = acts
    .filter((a) => nightOf(a.blockTime, offset) >= from30)
    .map((a) => {
      const d = new Date((a.blockTime + offset * 60) * 1000);
      const h = d.getUTCHours();
      return ((h < 5 ? h + 24 : h) - 18) * 60 + d.getUTCMinutes();
    });

  return {
    source,
    address,
    asOf: now.toISOString(),
    complete,
    first,
    last,
    acts: acts.length,
    load,
    loadNow,
    last30: {
      awakeNights: sum(nights.awake, from30),
      lateActs: sum(nights.late, from30),
      swaps: sum(nights.swaps, from30),
      usd: sum(nights.usd, from30),
      failed: sum(nights.failed, from30),
    },
    clock,
    hours: hourly(acts, offset, now),
    trades: acts.map(tradeOf).filter((x): x is Trade => x !== null),
    ...(parts
      ? { members: parts.map((p) => p.address), holdings: addHoldings(parts.map((p) => holdingsOf(p.acts))), cost: addCost(parts.map((p) => positions(p.acts, offset))) }
      : {
          holdings: holdingsOf(acts),
          cost: (() => {
            const p = positions(acts, offset);
            return { now: p.now, byNight: [...p.byNight.entries()] };
          })(),
        }),
  };
}

/* ── Several wallets as one ─────────────────────────────────────────────── */

function addHoldings(lists: Holding[][]): Holding[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const h of l) m.set(h.mint, (m.get(h.mint) ?? 0) + h.amount);
  return [...m.entries()].map(([mint, amount]) => ({ mint, amount }));
}

function addPositions(lists: CostPosition[][]): CostPosition[] {
  const m = new Map<string, CostPosition>();
  for (const l of lists) {
    for (const p of l) {
      const e = m.get(p.mint) ?? { mint: p.mint, amount: 0, costed: 0, cost: 0 };
      m.set(p.mint, { mint: p.mint, amount: e.amount + p.amount, costed: e.costed + p.costed, cost: e.cost + p.cost });
    }
  }
  return [...m.values()];
}

/**
 * Each wallet's positions added up, now and at the end of every night any of
 * them had an act: on a night one wallet was quiet, it holds what it held
 * after its last act before.
 */
function addCost(ps: { now: CostPosition[]; byNight: Map<string, CostPosition[]> }[]): WalletView["cost"] {
  const nights = [...new Set(ps.flatMap((p) => [...p.byNight.keys()]))].sort();
  const sorted = ps.map((p) => [...p.byNight.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const at = sorted.map(() => -1);
  const byNight: [string, CostPosition[]][] = nights.map((night) => {
    const lists = sorted.map((s, k) => {
      while (at[k] + 1 < s.length && s[at[k] + 1][0] <= night) at[k]++;
      return at[k] >= 0 ? s[at[k]][1] : [];
    });
    return [night, addPositions(lists)];
  });
  return { now: addPositions(ps.map((p) => p.now)), byNight };
}

/**
 * Several wallets' valued acts as one person's: merged in time order, each
 * swap's share taken of all the wallets' liquid holdings together.
 *
 * A swap of $1,000 is half of a $2,000 wallet but a twentieth of $20,000 held
 * across three, and the second is what that person had on the line.
 *
 * The wallet that made the swap is read exactly as alone (`valueActs` in
 * `engine/wallet.ts`), so a group of one reads as its wallet. The others'
 * SOL and stablecoins are as last seen: each coin's balance after the wallet's
 * last act that moved it, and before its first, the balance going into that
 * one. A deposit none of them signed is missed until the next act, as for a
 * single wallet. Each act keeps its own wallet's legs; only the share changes.
 */
export function combineActs(parts: { acts: WalletAct[] }[], solClose: Nightly): WalletAct[] {
  const days = [...solClose.keys()].sort();
  const priceOn = (day: string): number | null => {
    if (solClose.has(day)) return solClose.get(day)!;
    let best: string | null = null;
    for (const d of days) if (d <= day) best = d;
    return best ? solClose.get(best)! : null;
  };
  // Each wallet's first sight of SOL and of each stablecoin: what it held going in.
  const firstSeen = parts.map((p) => {
    const m = new Map<string, number>();
    for (const a of [...p.acts].sort((x, y) => x.blockTime - y.blockTime))
      for (const l of a.legs ?? []) if ((l.mint === SOL || STABLE_MINTS[l.mint]) && !m.has(l.mint)) m.set(l.mint, l.pre);
    return m;
  });
  const seen = parts.map(() => new Map<string, number>());
  const merged = parts
    .flatMap((p, k) => p.acts.map((a) => ({ a, k })))
    .sort((x, y) => x.a.blockTime - y.a.blockTime || x.k - y.k);
  return merged.map(({ a, k }) => {
    const legs = a.legs ?? [];
    const price = priceOn(new Date(a.blockTime * 1000).toISOString().slice(0, 10));
    const value = (mint: string, v: number) => (mint === SOL ? (price !== null ? v * price : 0) : v);
    // The wallet that acted, as `valueActs` reads it: SOL from this act, stablecoins as last seen by it.
    for (const l of legs) if (STABLE_MINTS[l.mint]) seen[k].set(l.mint, l.pre);
    const solLeg = legs.find((l) => l.mint === SOL);
    let liquid = (solLeg ? value(SOL, solLeg.pre) : 0) + [...seen[k].entries()].filter(([m]) => m !== SOL).reduce((s, [, v]) => s + v, 0);
    parts.forEach((_, j) => {
      if (j === k) return;
      for (const mint of new Set([...firstSeen[j].keys(), ...seen[j].keys()])) liquid += value(mint, seen[j].get(mint) ?? firstSeen[j].get(mint)!);
    });
    const share = a.kind === "swap" && a.usd != null && liquid > 0 ? Math.min(1, a.usd / liquid) : null;
    for (const l of legs) if (l.mint === SOL || STABLE_MINTS[l.mint]) seen[k].set(l.mint, l.pre + l.delta);
    return { ...a, share };
  });
}
