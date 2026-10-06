import { addDays, weekday, type Nightly } from "./nights";
import { rng } from "./stats";
import { SOL, STABLE_MINTS, type Leg, type WalletAct } from "./wallet";

/**
 * A trader who does not exist, for building the wallet side before anyone
 * connects a wallet with months of history.
 *
 * ── The layer it enters at ───────────────────────────────────────────────
 * Raw signed acts with their balance legs — what `legsOf` makes of a real
 * transaction — so everything after it runs as for a real wallet: `valueActs`
 * prices the legs and sizes each swap against the balances, `walletNights`
 * files it under its night, the band reads the week against the wallet's own
 * normal. SOL legs are priced from real daily closes passed in, so dollars and
 * SOL agree the way they would on chain.
 *
 * ── What it is NOT ───────────────────────────────────────────────────────
 * Anybody's trading. Every constant below was chosen to look like an active
 * retail trader, not taken from a source, and nothing generated here may be
 * shown without saying it is synthetic.
 *
 * ── The planted habit ─────────────────────────────────────────────────────
 * Given `below` — the nights a body read below its normal — the trader trades
 * more often, bigger, and later on the night AFTER each one: the habit the
 * readiness question asks about. Planted so the questions have something to
 * find while the screens are built, and so a test can check they find it.
 * Without `below`, nothing is planted and nothing should be found.
 */

export interface SyntheticWalletOptions {
  seed?: number;
  days?: number;
  /** The evening of the most recent night: keep it the same as the body's. */
  last: string;
  /** The reader's UTC offset, minutes (Ecuador: -300). */
  offsetMinutes: number;
  /** SOL's daily close by UTC date. A night with no close at or before it is skipped. */
  solClose: Nightly;
  /** Nights a body read below its normal. The night after each trades heavier. */
  below?: Set<string>;
  /**
   * Real tokens to trade against USDC, each with its daily USD close by UTC
   * date. Given, the trader buys and sells these at their real prices, so a
   * chart of the token shows the trades where they would have landed. Absent,
   * it trades one unpriced placeholder token, as before.
   */
  tokens?: { mint: string; close: Nightly }[];
}

const USDC = Object.keys(STABLE_MINTS).find((k) => STABLE_MINTS[k] === "USDC")!;
/** An unpriced token: what a memecoin looks like to the sizing, which reads such a swap off its USDC leg. */
export const SYNTHETIC_TOKEN = "SynthToken111111111111111111111111111111111";

// Chosen, not sourced — see above.
const START_SOL = 30;
const START_USDC = 2500;
const P_TRADE = { weeknight: 0.55, weekend: 0.4 };
const MEAN_EXTRA_SWAPS = 0.9;
const SHARE_MEDIAN = 0.05;
const SHARE_LOG_SD = 0.6;
const P_LATE = 0.08;
const P_FAIL = { evening: 0.04, late: 0.12 };
const WEEKLY_DEPOSIT = 400;
/** The habit: how much heavier the night after a below-normal one is. */
const HABIT = { trade: 1.6, extraSwaps: 1.6, size: 2.2, late: 0.35 };

const MIN = 60;

export function syntheticWalletActs(o: SyntheticWalletOptions): WalletAct[] {
  const { seed = 7, days = 210, last, offsetMinutes, solClose, below } = o;
  const tokens = (o.tokens ?? []).filter((t) => t.close.size);
  const tokenDays = tokens.map((t) => [...t.close.keys()].sort());
  const tokenPrice = (k: number, unix: number): number | null => {
    const day = new Date(unix * 1000).toISOString().slice(0, 10);
    let best: string | null = null;
    for (const d of tokenDays[k]) if (d <= day) best = d;
    return best ? tokens[k].close.get(best)! : null;
  };
  const held = tokens.map(() => 0);
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const closeDays = [...solClose.keys()].sort();
  const priceAt = (unix: number): number | null => {
    const day = new Date(unix * 1000).toISOString().slice(0, 10);
    let best: string | null = null;
    for (const d of closeDays) if (d <= day) best = d;
    return best ? solClose.get(best)! : null;
  };
  /** Minutes past the evening's 18:00, local, as a unix time. */
  const at = (night: string, minutesPast18: number) =>
    Date.parse(`${night}T18:00:00Z`) / 1000 + minutesPast18 * MIN - offsetMinutes * MIN;

  let sol = START_SOL;
  let usdc = START_USDC;
  let token = 0;
  const acts: WalletAct[] = [];
  const first = addDays(last, -(days - 1));

  for (let i = 0; i < days; i++) {
    const night = addDays(first, i);
    const wd = weekday(night);
    const habit = below?.has(addDays(night, -1)) ?? false;

    // Paid on Friday evenings, so the wallet does not drain into the token —
    // at 18:05, before any trade that night, so each later leg's balance is
    // the one it would have seen.
    if (wd === 5) {
      const t = at(night, 5);
      acts.push({ blockTime: t, failed: false, legs: [{ mint: SOL, pre: sol, delta: 0 }, { mint: USDC, pre: usdc, delta: WEEKLY_DEPOSIT }] });
      usdc += WEEKLY_DEPOSIT;
    }

    const pTrade = Math.min(0.95, (wd === 5 || wd === 6 || wd === 0 ? P_TRADE.weekend : P_TRADE.weeknight) * (habit ? HABIT.trade : 1));
    if (rand() >= pTrade) continue;
    const n = Math.min(6, 1 + Math.floor(-Math.log(rand() || 1e-12) * (habit ? HABIT.extraSwaps : MEAN_EXTRA_SWAPS)));

    const times = Array.from({ length: n }, () =>
      rand() < (habit ? HABIT.late : P_LATE)
        ? 360 + rand() * 240 // 00:00–04:00
        : Math.min(350, Math.max(30, 150 + gauss() * 75)), // around 20:30
    ).sort((a, b) => a - b);

    for (const m of times) {
      const t = at(night, m);
      const price = priceAt(t);
      if (price === null) continue;
      if (rand() < (m >= 360 ? P_FAIL.late : P_FAIL.evening)) {
        // A failed swap moves nothing but the fee.
        acts.push({ blockTime: t, failed: true, legs: [{ mint: SOL, pre: sol, delta: 0 }] });
        continue;
      }
      const liquid = sol * price + usdc;
      const share = Math.min(0.5, Math.exp(Math.log(SHARE_MEDIAN) + SHARE_LOG_SD * gauss()) * (habit ? HABIT.size : 1));
      const usd = share * liquid;
      const r = rand();
      let legs: Leg[] | null = null;
      if (tokens.length && r < 0.3) {
        // A real token, bought with USDC or sold back into it, at that day's close.
        const k = Math.floor(rand() * tokens.length);
        const p = tokenPrice(k, t);
        if (p !== null && p > 0) {
          const mint = tokens[k].mint;
          if (held[k] * p > 1 && rand() < 0.45) {
            const value = Math.min(usd, held[k] * p);
            const gave = value / p;
            legs = [{ mint: SOL, pre: sol, delta: 0 }, { mint: USDC, pre: usdc, delta: value }, { mint, pre: held[k], delta: -gave }];
            usdc += value;
            held[k] -= gave;
          } else if (usdc > usd) {
            const got = usd / p;
            legs = [{ mint: SOL, pre: sol, delta: 0 }, { mint: USDC, pre: usdc, delta: -usd }, { mint, pre: held[k], delta: got }];
            usdc -= usd;
            held[k] += got;
          }
        }
      } else if (!tokens.length && r < 0.15 && usdc > usd) {
        const got = usd / (0.0004 + rand() * 0.0002);
        legs = [{ mint: SOL, pre: sol, delta: 0 }, { mint: USDC, pre: usdc, delta: -usd }, { mint: SYNTHETIC_TOKEN, pre: token, delta: got }];
        usdc -= usd;
        token += got;
      } else if (usdc > usd && (r < 0.575 || sol * price < usd)) {
        const got = usd / price;
        legs = [{ mint: SOL, pre: sol, delta: got }, { mint: USDC, pre: usdc, delta: -usd }];
        usdc -= usd;
        sol += got;
      } else if (sol * price > usd) {
        const gave = usd / price;
        legs = [{ mint: SOL, pre: sol, delta: -gave }, { mint: USDC, pre: usdc, delta: usd }];
        sol -= gave;
        usdc += usd;
      }
      if (legs) acts.push({ blockTime: t, failed: false, legs });
    }
  }
  return acts.sort((a, b) => a.blockTime - b.blockTime);
}
