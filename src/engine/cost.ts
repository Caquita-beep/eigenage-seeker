import { addDays, nightOf, type Nightly } from "./nights";
import { SOL, STABLE_MINTS, type WalletAct } from "./wallet";

/**
 * What each coin in the wallet cost, and whether it is underwater.
 *
 * ── Average cost ─────────────────────────────────────────────────────────
 * A buy adds its dollars and its coins. Anything that leaves (a sale, a
 * transfer out, a fee) takes its share of both, so the average does not move
 * when you sell; only buying changes it. Read from the wallet's own balance
 * changes, both sides of every swap: paying for a coin with SOL is a sale of
 * SOL and a buy of the coin, at the swap's dollar size.
 *
 * Coins that arrive with no price — held before the history starts, sent in,
 * airdropped, or swapped from a coin with no priced side — are held at an
 * unknown cost. The average covers the coins whose cost is known, and
 * `costed` says how many those are. Nothing is guessed.
 *
 * ── Underwater ───────────────────────────────────────────────────────────
 * At each day's close, the coins with a known cost are worth more or less than
 * they cost. The gap, as a share of the cost, is the position's state that
 * night: below zero is underwater. Stablecoins are cash, not positions.
 */

export interface Position {
  mint: string;
  amount: number;
  /** How much of `amount` has a known cost. */
  costed: number;
  /** What the costed coins cost, in USD. */
  cost: number;
}

const EPS = 1e-9;

export const averageCost = (p: Position): number | null => (p.costed > EPS ? p.cost / p.costed : null);

/** Scale a position down to `to` coins, keeping its average cost. */
function shrink(p: Position, to: number) {
  const f = p.amount > EPS ? Math.max(0, to) / p.amount : 0;
  p.costed *= f;
  p.cost *= f;
  p.amount = Math.max(0, to);
}

/** Which leg of a swap was bought with its dollars: a coin other than SOL first, else SOL; none when cash was received. */
function boughtLeg(a: WalletAct): string | null {
  if (a.failed || !a.usd || a.usd <= 0 || !a.legs || (a.kind && a.kind !== "swap")) return null;
  const up = a.legs.filter((l) => l.delta > 0);
  if (up.some((l) => STABLE_MINTS[l.mint])) return null;
  const coins = up.filter((l) => l.mint !== SOL);
  if (coins.length === 1) return coins[0].mint;
  if (coins.length === 0 && up.some((l) => l.mint === SOL) && a.legs.some((l) => l.delta < 0)) return SOL;
  return null;
}

export interface Positions {
  /** As of the last act. */
  now: Position[];
  /** As of the end of each night that had an act, by night. */
  byNight: Map<string, Position[]>;
}

export function positions(acts: WalletAct[], offsetMinutes: number): Positions {
  const book = new Map<string, Position>();
  const byNight = new Map<string, Position[]>();
  const snapshot = () => [...book.values()].filter((p) => p.amount > EPS).map((p) => ({ ...p }));

  for (const a of [...acts].sort((x, y) => x.blockTime - y.blockTime)) {
    if (!a.legs) continue;
    const bought = a.failed ? null : boughtLeg(a);
    for (const l of a.legs) {
      if (STABLE_MINTS[l.mint]) continue;
      const p = book.get(l.mint) ?? { mint: l.mint, amount: 0, costed: 0, cost: 0 };
      book.set(l.mint, p);
      // The chain's balance before this act: what arrived or left unseen in between.
      if (l.pre > p.amount + EPS) p.amount = l.pre;
      else if (l.pre < p.amount - EPS) shrink(p, l.pre);
      if (a.failed || l.delta === 0) continue;
      if (l.delta > 0) {
        if (l.mint === bought) {
          p.costed += l.delta;
          p.cost += a.usd!;
        }
        p.amount += l.delta;
      } else {
        shrink(p, p.amount + l.delta);
      }
    }
    byNight.set(nightOf(a.blockTime, offsetMinutes), snapshot());
  }
  return { now: snapshot(), byNight };
}

export interface Water {
  /** Value of the costed coins at the price, less what they cost, in USD. */
  gain: number;
  /** `gain` as a share of the cost: below zero is underwater. */
  pct: number;
  cost: number;
}

/** A position's state at a price, or null when its cost is unknown. */
export function water(p: Position, price: number): Water | null {
  if (p.costed <= EPS || p.cost <= 0) return null;
  const gain = p.costed * price - p.cost;
  return { gain, pct: gain / p.cost, cost: p.cost };
}

/** Too little at stake to say anything about being underwater. */
export const MIN_AT_STAKE = 20;

/**
 * Night by night, the whole wallet's costed coins against their cost at that
 * day's close: the share above (positive) or below (negative) what they cost.
 * A night is left out when nothing costed is held, the stake is under
 * `MIN_AT_STAKE`, or a held coin has no close that day.
 */
/**
 * What the market did to the wallet each day: the coins held at the previous
 * night's end, valued at this close against the last, as a percent of their
 * value then. Trades, deposits and withdrawals do not count, only price; cash
 * moves nothing, so in dollars this is the day's change in the balance. A coin
 * with no price history is left out, as in `underwaterSeries`.
 */
export function returnSeries(p: Positions, closes: Record<string, Nightly>, from: string, to: string): Nightly {
  const out: Nightly = new Map();
  let held: Position[] = [];
  const nights = [...p.byNight.keys()].sort();
  let k = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const prev = addDays(d, -1);
    while (k < nights.length && nights[k] <= prev) held = p.byNight.get(nights[k++])!;
    let before = 0;
    let after = 0;
    let ok = true;
    for (const pos of held) {
      if (!closes[pos.mint]) continue;
      const a = closes[pos.mint].get(prev);
      const b = closes[pos.mint].get(d);
      if (a === undefined || b === undefined) {
        ok = false;
        break;
      }
      before += pos.amount * a;
      after += pos.amount * b;
    }
    if (ok && before >= MIN_AT_STAKE) out.set(d, 100 * (after / before - 1));
  }
  return out;
}

export function underwaterSeries(p: Positions, closes: Record<string, Nightly>, from: string, to: string): Nightly {
  const out: Nightly = new Map();
  let held: Position[] = [];
  const nights = [...p.byNight.keys()].sort();
  let k = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    while (k < nights.length && nights[k] <= d) held = p.byNight.get(nights[k++])!;
    let cost = 0;
    let value = 0;
    let ok = true;
    for (const pos of held) {
      // A coin with no price history at all cannot be valued; it is left out rather than voiding every night.
      if (pos.costed <= EPS || !closes[pos.mint]) continue;
      const c = closes[pos.mint].get(d);
      if (c === undefined) {
        ok = false;
        break;
      }
      cost += pos.cost;
      value += pos.costed * c;
    }
    if (ok && cost >= MIN_AT_STAKE) out.set(d, value / cost - 1);
  }
  return out;
}
