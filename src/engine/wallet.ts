import { signaturesForAddress, transaction, type ConfirmedTransaction } from "./rpc";
import { addDays, minutesIntoNight, nightOf, type Nightly } from "./nights";


/**
 * Wallet activity: the one health-relevant stream that exists only because it
 * is on a chain.
 *
 * The valuable part is not WHAT was traded but WHEN. Every transaction carries
 * a finalized timestamp nobody can edit afterwards, so a swap at 02:40 is
 * proof that someone was awake at 02:40 — a sleep-diary entry the person never
 * had to write. That is why the primary wallet exposure is night activity, not
 * volume or profit: it sits one step from sleep, and sleep sits one step from
 * HRV. Profit and loss would need every swap priced and every token tracked,
 * for a variable that reaches the body through the same late night anyway.
 *
 * ── Only what the wallet signed ──────────────────────────────────────────
 * `getSignaturesForAddress` returns every transaction that MENTIONS an address,
 * and a busy wallet is mentioned constantly by strangers — spam tokens, dust,
 * airdrops, landing at 3 a.m. whether its owner is asleep or not. Counting
 * those would put noise exactly where the signal is supposed to be. So each
 * candidate is fetched and kept only if the wallet is a signer. That costs a
 * call per transaction; it is not optional.
 *
 * A wallet signing at night is still not certain proof of a person awake — a
 * bot holding the key, or a scheduled order, signs too. Said on the page, not
 * solved here.
 */

export interface WalletAct {
  blockTime: number;
  failed: boolean;
  /** The wallet's own balance changes in this transaction. */
  legs?: Leg[];
  kind?: Kind;
  /** Dollar size of the trade, from its priced leg. Null when no leg is priced. */
  usd?: number | null;
  /** That size as a fraction of the wallet's liquid holdings just before it. */
  share?: number | null;
}

/* ── Size, against the wallet's own balance ────────────────────────────────
 * A count treats a $5 swap and a $50,000 one alike. What loads a person is how
 * much of what they have was on the line, so the measure is the share of the
 * wallet's LIQUID holdings — SOL and dollars — a swap moved.
 *
 * Priced legs only: SOL at the day's close, USDC and USDT at a dollar. Nearly
 * every swap on Solana routes through one of the three, so the other side's
 * value is read off it; a memecoin-to-memecoin swap with neither is left
 * unsized rather than guessed.
 *
 * The denominator is exact for SOL (every transaction carries the signer's
 * lamports) and last-seen for stablecoins: a USDC balance is known from the
 * last transaction that touched it and carried forward. A deposit in between
 * that the wallet did not sign is missed until the next time the account is
 * touched, which overstates share for a while. Accepted; the alternative is a
 * balance query per night.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** Verified against mainnet getTokenSupply, 24 Sep 2026. */
export const STABLE_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};
/** Native SOL and wrapped SOL, folded into one leg. */
export const SOL = "SOL";

/**
 * SOL moves smaller than this are rent and fees, not trading. Opening a token
 * account locks 0.00204 SOL, and a swap often opens one or two.
 */
const RENT_NOISE_SOL = 0.005;

export interface Leg {
  mint: string;
  /** Balance before, in whole tokens. */
  pre: number;
  /** After minus before, in whole tokens. */
  delta: number;
}

export type Kind = "swap" | "send" | "receive" | "other";

/** The wallet's balance changes in one transaction, fees excluded. */
export function legsOf(tx: ConfirmedTransaction, wallet: string): Leg[] {
  const keys = tx.transaction?.message.accountKeys ?? [];
  const meta = tx.meta;
  const i = keys.findIndex((k) => k.pubkey === wallet);
  if (!meta || i < 0) return [];

  const byMint = new Map<string, { pre: number; post: number }>();
  const add = (mint: string, side: "pre" | "post", v: number) => {
    const m = mint === WSOL_MINT ? SOL : mint;
    const e = byMint.get(m) ?? { pre: 0, post: 0 };
    e[side] += v;
    byMint.set(m, e);
  };
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner === wallet) add(b.mint, "pre", Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals);
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner === wallet) add(b.mint, "post", Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals);
  }
  if (meta.preBalances && meta.postBalances) {
    // The fee is paid by account 0; put it back so it does not read as a trade.
    const fee = i === 0 ? (meta.fee ?? 0) : 0;
    add(SOL, "pre", meta.preBalances[i] / 1e9);
    add(SOL, "post", (meta.postBalances[i] + fee) / 1e9);
  }

  const legs: Leg[] = [];
  for (const [mint, { pre, post }] of byMint) {
    const delta = post - pre;
    const noise = mint === SOL ? RENT_NOISE_SOL : 1e-9;
    if (Math.abs(delta) > noise || mint === SOL) legs.push({ mint, pre, delta: Math.abs(delta) > noise ? delta : 0 });
  }
  return legs;
}

export function kindOf(legs: Leg[]): Kind {
  const out = legs.some((l) => l.delta < 0);
  const inn = legs.some((l) => l.delta > 0);
  return out && inn ? "swap" : out ? "send" : inn ? "receive" : "other";
}

/**
 * Dollar size and share of liquid holdings for each act, in time order.
 * `solClose` is SOL's daily close keyed by UTC date; a day without one uses
 * the last close before it.
 */
export function valueActs(acts: WalletAct[], solClose: Nightly): WalletAct[] {
  const days = [...solClose.keys()].sort();
  const priceOn = (day: string): number | null => {
    if (solClose.has(day)) return solClose.get(day)!;
    let best: string | null = null;
    for (const d of days) if (d <= day) best = d;
    return best ? solClose.get(best)! : null;
  };
  const stables = new Map<string, number>();
  return [...acts]
    .sort((a, b) => a.blockTime - b.blockTime)
    .map((a) => {
      const legs = a.legs ?? [];
      const sol = priceOn(new Date(a.blockTime * 1000).toISOString().slice(0, 10));
      const price = (mint: string) => (mint === SOL ? sol : STABLE_MINTS[mint] ? 1 : null);

      for (const l of legs) if (STABLE_MINTS[l.mint]) stables.set(l.mint, l.pre);
      const solLeg = legs.find((l) => l.mint === SOL);
      const liquid =
        (solLeg && sol !== null ? solLeg.pre * sol : 0) + [...stables.values()].reduce((s, v) => s + v, 0);

      const kind = kindOf(legs);
      const priced = legs
        .map((l) => ({ l, p: price(l.mint) }))
        .filter((x) => x.p !== null && x.l.delta !== 0)
        .map((x) => Math.abs(x.l.delta) * x.p!);
      const usd = priced.length ? Math.max(...priced) : null;
      const share = kind === "swap" && usd !== null && liquid > 0 ? Math.min(1, usd / liquid) : null;

      for (const l of legs) if (STABLE_MINTS[l.mint]) stables.set(l.mint, l.pre + l.delta);
      return { ...a, kind, usd, share };
    });
}

/** Local night minutes from 18:00: 22:00 is 240, midnight 360, 05:00 is 660. */
const LATE_FROM = 240;
const NIGHT_FROM = 360;

export interface WalletNights {
  /** Any signed transaction between midnight and 05:00. The primary exposure. */
  awake: Nightly;
  /** Signed transactions from 22:00 to 05:00. */
  late: Nightly;
  /** All signed transactions in the night's 24 hours (05:00 to 05:00). */
  count: Nightly;
  /** Failed ones — slippage and congestion, the retry-at-2am kind. */
  failed: Nightly;
  /** Swaps, of any size. */
  swaps: Nightly;
  /** Dollars swapped. */
  usd: Nightly;
  /**
   * Sum of each swap's share of liquid holdings. 0.5 is half the wallet moved
   * once, or a quarter of it moved twice. The trading load.
   */
  share: Nightly;
  /**
   * Minutes past 18:00 of the last act before 05:00. Absent on nights with no
   * evening activity: "nothing after six" is not the same as "stopped at six".
   */
  lastAct: Nightly;
}

/**
 * Per-night features over [first, last]. Nights in range with no activity are
 * real zeros — the wallet was watched and nothing happened — and are filled as
 * such; nights outside it are unknown and left absent.
 */
export function walletNights(
  acts: WalletAct[],
  offsetMinutes: number,
  first: string,
  last: string,
): WalletNights {
  const out: WalletNights = {
    awake: new Map(),
    late: new Map(),
    count: new Map(),
    failed: new Map(),
    lastAct: new Map(),
    swaps: new Map(),
    usd: new Map(),
    share: new Map(),
  };
  for (let d = first; d <= last; d = addDays(d, 1)) {
    out.awake.set(d, 0);
    out.late.set(d, 0);
    out.count.set(d, 0);
    out.failed.set(d, 0);
    out.swaps.set(d, 0);
    out.usd.set(d, 0);
    out.share.set(d, 0);
  }

  const bump = (m: Nightly, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const a of acts) {
    const night = nightOf(a.blockTime, offsetMinutes);
    if (night < first || night > last) continue;
    const min = minutesIntoNight(a.blockTime, offsetMinutes);
    bump(out.count, night);
    if (a.failed) bump(out.failed, night);
    if (min >= LATE_FROM) bump(out.late, night);
    if (min >= NIGHT_FROM) out.awake.set(night, 1);
    if (min >= 0 && min > (out.lastAct.get(night) ?? -1)) out.lastAct.set(night, min);
    if (a.kind === "swap" && !a.failed) {
      bump(out.swaps, night);
      out.usd.set(night, out.usd.get(night)! + (a.usd ?? 0));
      out.share.set(night, out.share.get(night)! + (a.share ?? 0));
    }
  }
  return out;
}

/**
 * The wallet's own signed transactions since `sinceUnix`, oldest first.
 *
 * `maxCandidates` bounds the RPC bill for very active wallets. When it bites,
 * `complete` is false and the caller must start the series at the oldest act
 * returned, not at `sinceUnix` — otherwise the unfetched early days read as
 * quiet nights.
 */
export async function fetchSignedActs(
  wallet: string,
  sinceUnix: number,
  maxCandidates = 3000,
  concurrency = 8,
): Promise<{ acts: WalletAct[]; complete: boolean }> {
  const candidates: { signature: string; blockTime: number; failed: boolean }[] = [];
  let before: string | undefined;
  let complete = false;
  while (candidates.length < maxCandidates) {
    const page = await signaturesForAddress(wallet, 1000, before);
    for (const s of page) {
      if (s.blockTime === null) continue;
      if (s.blockTime < sinceUnix) {
        complete = true;
        break;
      }
      candidates.push({ signature: s.signature, blockTime: s.blockTime, failed: s.err !== null });
    }
    if (complete || page.length < 1000) {
      complete = true;
      break;
    }
    before = page[page.length - 1].signature;
  }

  const acts: WalletAct[] = [];
  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const txs = await Promise.all(chunk.map((c) => transaction(c.signature)));
    chunk.forEach((c, j) => {
      const tx = txs[j];
      const keys = tx?.transaction?.message.accountKeys ?? [];
      if (tx && keys.some((k) => k.pubkey === wallet && k.signer)) {
        acts.push({ blockTime: c.blockTime, failed: c.failed, legs: legsOf(tx, wallet) });
      }
    });
  }
  return { acts: acts.reverse(), complete };
}
