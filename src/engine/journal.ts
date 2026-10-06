import { addDays, minutesIntoNight, nightOf } from "./nights";

/**
 * A trading journal: what was bought and sold, and what it made or lost.
 *
 * ── Profit and loss ──────────────────────────────────────────────────────
 * First in, first out, per coin, in USD. A buy opens a lot at what it cost;
 * a sell closes the oldest lots first, and its profit is what it fetched
 * minus what those lots cost. What is still held at the end is an open
 * position, worth its amount at today's price. A sell of more than the
 * history shows was bought (coins held before the history starts) has no
 * known cost: that part is counted, never priced. A coin bought with SOL is
 * its own trade; the SOL that paid for it is not booked as a SOL sale.
 *
 * ── Periods ──────────────────────────────────────────────────────────────
 * Trades are filed under their night (`nights.ts`), so a 2 a.m. trade sits
 * with the evening before. Weeks run Monday to Sunday by night; months by the
 * night's calendar month. A period's profit is what its sells realised.
 */

export interface JournalTrade {
  t: number;
  mint: string;
  side: "buy" | "sell";
  amount: number;
  usd: number | null;
}

export interface Fill extends JournalTrade {
  /** Index into the trades as given. */
  i: number;
  night: string;
  /** After midnight on the reader's clock. */
  late: boolean;
  /** A sell's profit on the part matched to earlier buys; null for buys, and for sells with nothing matched. */
  pnl: number | null;
  /** Of a sell's amount, how much had no earlier buy to match. */
  unmatched: number;
  /** For a sell, the night of the oldest buy it closed. */
  boughtNight: string | null;
}

export interface Lot {
  /** The buy's index into the trades. */
  i: number;
  mint: string;
  night: string;
  amount: number;
  /** What the amount still held cost, in USD. */
  cost: number;
}

export interface Ledger {
  fills: Fill[];
  /** What is still held, oldest first, per coin. */
  open: Lot[];
  /** Per buy (by trade index): profit realised so far from the sells that closed it. */
  realisedByBuy: Map<number, number>;
}

const EPS = 1e-12;

export function ledger(trades: JournalTrade[], offsetMinutes: number): Ledger {
  const order = trades.map((t, i) => ({ t, i })).sort((a, b) => a.t.t - b.t.t || a.i - b.i);
  const lots = new Map<string, Lot[]>();
  const realisedByBuy = new Map<number, number>();
  const fills: Fill[] = [];

  for (const { t, i } of order) {
    const unix = t.t / 1000;
    const night = nightOf(unix, offsetMinutes);
    const base = { ...t, i, night, late: minutesIntoNight(unix, offsetMinutes) >= 360 };
    const queue = lots.get(t.mint) ?? [];
    lots.set(t.mint, queue);

    if (t.side === "buy") {
      fills.push({ ...base, pnl: null, unmatched: 0, boughtNight: null });
      if (t.usd !== null && t.usd > 0 && t.amount > 0) queue.push({ i, mint: t.mint, night, amount: t.amount, cost: t.usd });
      continue;
    }

    // A sell: close the oldest lots first.
    let left = t.amount;
    let matched = 0;
    let cost = 0;
    let boughtNight: string | null = null;
    const price = t.usd !== null && t.amount > 0 ? t.usd / t.amount : null;
    while (left > EPS && queue.length) {
      const lot = queue[0];
      const take = Math.min(left, lot.amount);
      const part = lot.cost * (take / lot.amount);
      boughtNight ??= lot.night;
      if (price !== null) realisedByBuy.set(lot.i, (realisedByBuy.get(lot.i) ?? 0) + take * price - part);
      cost += part;
      matched += take;
      lot.amount -= take;
      lot.cost -= part;
      left -= take;
      if (lot.amount <= EPS) queue.shift();
    }
    fills.push({
      ...base,
      pnl: price !== null && matched > EPS ? matched * price - cost : null,
      unmatched: Math.max(0, left),
      boughtNight,
    });
  }

  return { fills, open: [...lots.values()].flat(), realisedByBuy };
}

/** Open positions valued at `prices` (USD per coin): what they cost, what they are worth, per coin. */
export function openPositions(open: Lot[], prices: Record<string, number>) {
  const by = new Map<string, { mint: string; amount: number; cost: number; value: number | null }>();
  for (const l of open) {
    const p = by.get(l.mint) ?? { mint: l.mint, amount: 0, cost: 0, value: 0 };
    p.amount += l.amount;
    p.cost += l.cost;
    p.value = prices[l.mint] === undefined || p.value === null ? null : p.value + l.amount * prices[l.mint];
    by.set(l.mint, p);
  }
  return [...by.values()];
}

/**
 * Each buy's outcome so far: what its closed part realised, plus its open
 * part at today's price less what that part cost. Null when the coin has no
 * price today and part of it is still held.
 */
export function buyOutcomes(l: Ledger, prices: Record<string, number>): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const f of l.fills) if (f.side === "buy" && f.usd !== null && f.usd > 0) out.set(f.i, l.realisedByBuy.get(f.i) ?? 0);
  for (const lot of l.open) {
    const p = prices[lot.mint];
    const prev = out.get(lot.i);
    if (prev === undefined) continue;
    out.set(lot.i, p === undefined || prev === null ? null : prev + lot.amount * p - lot.cost);
  }
  return out;
}

export type PeriodKind = "day" | "week" | "month";

/** The night a period starts on: the night itself, its week's Monday, or its month's first. */
export function periodOf(night: string, kind: PeriodKind): string {
  if (kind === "day") return night;
  if (kind === "month") return `${night.slice(0, 7)}-01`;
  const d = new Date(`${night}T00:00:00Z`);
  return addDays(night, -((d.getUTCDay() + 6) % 7));
}

/** The last night of the period starting `start`. */
export function periodEnd(start: string, kind: PeriodKind): string {
  if (kind === "day") return start;
  if (kind === "week") return addDays(start, 6);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(d.toISOString().slice(0, 10), -1);
}

export interface Period {
  start: string;
  end: string;
  fills: Fill[];
  buys: number;
  sells: number;
  /** USD that changed hands. */
  volume: number;
  /** What the period's sells realised. */
  realised: number;
  /** Sells with a profit, and with a loss. */
  won: number;
  lost: number;
}

/** The periods that had trades, newest first. */
export function periods(fills: Fill[], kind: PeriodKind): Period[] {
  const by = new Map<string, Fill[]>();
  for (const f of fills) {
    const k = periodOf(f.night, kind);
    by.set(k, [...(by.get(k) ?? []), f]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([start, fs]) => summarise(start, periodEnd(start, kind), fs));
}

export function summarise(start: string, end: string, fills: Fill[]): Period {
  const sells = fills.filter((f) => f.side === "sell");
  return {
    start,
    end,
    fills: [...fills].sort((a, b) => a.t - b.t),
    buys: fills.length - sells.length,
    sells: sells.length,
    volume: fills.reduce((s, f) => s + (f.usd ?? 0), 0),
    realised: sells.reduce((s, f) => s + (f.pnl ?? 0), 0),
    won: sells.filter((f) => (f.pnl ?? 0) > 0).length,
    lost: sells.filter((f) => (f.pnl ?? 0) < 0).length,
  };
}
