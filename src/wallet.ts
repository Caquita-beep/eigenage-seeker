import AsyncStorage from "@react-native-async-storage/async-storage";
import { readings } from "./engine/hrv";
import { fetchBars, type Bar } from "./engine/market";
import { addDays, nightOf, type Nightly } from "./engine/nights";
import { syntheticWalletActs } from "./engine/synthetic-wallet";
import { fetchSignedActs, valueActs, type WalletAct } from "./engine/wallet";
import { toNightly } from "./engine/whoop/nightly";
import { syntheticMember } from "./engine/whoop/synthetic";
import { SYNTHETIC_DAYS } from "./body";
import { BONK_MINT, dailyCloses, JUP_MINT } from "./coins";
import { buildView, combineActs, type WalletView } from "./walletview";

export type { Point, WalletView } from "./walletview";

/**
 * The wallet side of Exposure: the connected wallet's own signed history,
 * read straight from the chain by the phone.
 *
 * Nothing is uploaded. The address comes from the Seeker's wallet through
 * Mobile Wallet Adapter, the history from a public RPC, and the result stays
 * on the phone. The chain is the backfill: months of activity are there on the
 * first connect, so the reader's normal exists before they have used the app
 * for a day.
 */

const WINDOW_DAYS = 120;
const key = (address: string) => `wallet:view:v4:${address}`;
/** A wallet's signed acts as read from the chain, before valuing: what a combined view is built from. */
const actsKey = (address: string) => `wallet:acts:v1:${address}`;
/** A group reuses a wallet read this recently instead of reading it again. */
const REUSE_MS = 5 * 60_000;
// Bumped by `forgetWallet`, so a read still in flight when a wallet is forgotten does not save it back.
let generation = 0;

export async function cachedWallet(address: string): Promise<WalletView | null> {
  try {
    const raw = await AsyncStorage.getItem(key(address));
    return raw ? (JSON.parse(raw) as WalletView) : null;
  } catch {
    return null;
  }
}

/**
 * Deletes this wallet's history from the phone, every stored version of it,
 * and every combined view, which may hold it.
 */
export async function forgetWallet(address: string) {
  generation++;
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) => ((k.startsWith("wallet:view:") || k.startsWith("wallet:acts:")) && k.endsWith(`:${address}`)) || k.startsWith("wallet:view:v4:group:"),
  );
  await AsyncStorage.multiRemove(keys);
}

/** Deletes a group's combined view. Its wallets keep theirs. */
export async function forgetGroup(groupKey: string) {
  generation++;
  await AsyncStorage.removeItem(key(groupKey));
}

interface Read {
  /** When it was read, ms. */
  at: number;
  acts: WalletAct[];
  complete: boolean;
  /** The start of the window asked for, unix seconds. */
  since: number;
}

/** A wallet's signed acts from the chain, or from the phone when read within `reuse` ms. */
async function readActs(address: string, reuse = 0): Promise<Read> {
  const gen = generation;
  if (reuse > 0) {
    try {
      const raw = await AsyncStorage.getItem(actsKey(address));
      const r = raw ? (JSON.parse(raw) as Read) : null;
      if (r && Date.now() - r.at < reuse) return r;
    } catch {}
  }
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86_400;
  const { acts, complete } = await fetchSignedActs(address, since, 1500, 4);
  const r: Read = { at: Date.now(), acts, complete, since };
  if (gen === generation) AsyncStorage.setItem(actsKey(address), JSON.stringify(r)).catch(() => {});
  return r;
}

/**
 * The first night the read covers. If it hit its limit, the series starts at
 * the oldest act fetched: earlier nights were not looked at, and must not read
 * as quiet ones.
 */
const firstOf = (r: Read, valued: WalletAct[], offset: number) =>
  r.complete || !valued.length ? nightOf(r.since, offset) : nightOf(valued[0].blockTime, offset);

async function solCloses(): Promise<Nightly> {
  const bars = await fetchBars("SOLUSDT", WINDOW_DAYS + 10);
  return new Map(bars.map((b) => [b.day, b.close]));
}

export async function loadWallet(address: string): Promise<WalletView> {
  const gen = generation;
  const now = new Date();
  // getTimezoneOffset is minutes BEHIND UTC; the engine wants the offset itself (Ecuador: -300).
  const offset = -now.getTimezoneOffset();
  const [r, closes] = await Promise.all([readActs(address), solCloses()]);
  const acts = valueActs(r.acts, closes);
  const last = nightOf(Math.floor(now.getTime() / 1000), offset);
  const view = buildView({ source: "chain", address, now, offset, acts, complete: r.complete, first: firstOf(r, acts, offset), last });
  if (gen === generation) AsyncStorage.setItem(key(address), JSON.stringify(view)).catch(() => {});
  return view;
}

/**
 * Several wallets read as one (`walletview.ts`, `combineActs`). Each is read
 * from the chain in turn — one at a time, as the public RPC allows — unless it
 * was read in the last few minutes. The series starts where every wallet's
 * read does, so a wallet whose read stopped short never shows as quiet nights.
 * Each wallet's own view is saved on the way, so opening one alone is quick.
 */
export async function loadGroup(groupKey: string, members: string[], progress?: (done: number, of: number) => void): Promise<WalletView> {
  const gen = generation;
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const closes = await solCloses();
  const last = nightOf(Math.floor(now.getTime() / 1000), offset);
  const reads: Read[] = [];
  for (const [i, address] of members.entries()) {
    progress?.(i, members.length);
    reads.push(await readActs(address, REUSE_MS));
  }
  const parts = members.map((address, k) => ({ address, acts: valueActs(reads[k].acts, closes) }));
  const firsts = parts.map((p, k) => firstOf(reads[k], p.acts, offset));
  const first = firsts.reduce((a, b) => (a > b ? a : b));
  const complete = reads.every((r) => r.complete);
  const view = buildView({ source: "chain", address: groupKey, now, offset, acts: combineActs(parts, closes), complete, first, last, parts });
  if (gen === generation) {
    AsyncStorage.setItem(key(groupKey), JSON.stringify(view)).catch(() => {});
    parts.forEach((p, k) => {
      const own = buildView({ source: "chain", address: p.address, now, offset, acts: p.acts, complete: reads[k].complete, first: firsts[k], last });
      AsyncStorage.setItem(key(p.address), JSON.stringify(own)).catch(() => {});
    });
  }
  return view;
}

/* ── Synthetic ──────────────────────────────────────────────────────────── */

const SYNTHETIC_KEY = "wallet:synthetic:v1";
// The same span as the synthetic body (`body.ts`).

export async function syntheticWalletOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SYNTHETIC_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setSyntheticWallet(on: boolean) {
  if (on) await AsyncStorage.setItem(SYNTHETIC_KEY, "1");
  else await AsyncStorage.removeItem(SYNTHETIC_KEY);
}

/**
 * A generated trader, for building the wallet screens before a wallet with
 * months of history is connected. Its trades are priced from SOL's real daily
 * closes and read through the same valuing and banding as a chain wallet.
 *
 * It carries one planted habit: it trades more, bigger and later the night
 * after the SYNTHETIC body (`loadSyntheticWhoop`) read below its normal —
 * always that member, never a real body, so no habit is ever planted against
 * anyone's own data. Regenerated on every open, like the body, so it always
 * ends last night.
 */
export async function loadSyntheticWallet(solBars?: Bar[], fear?: Map<string, number>): Promise<WalletView> {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  let bars = solBars ?? [];
  if (!bars.length) {
    try {
      bars = await fetchBars("SOLUSDT", SYNTHETIC_DAYS + 10);
    } catch {
      throw new Error("Synthetic trades are priced at SOL's real daily closes, and the market could not be reached. Pull to refresh once it can.");
    }
  }
  const closes: Nightly = new Map(bars.map((b) => [b.day, b.close]));

  const hhmm = `${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  // The same member the Body tab shows, fear link and all, so the trader's habit follows the body the reader sees.
  const member = syntheticMember({ timezoneOffset: `${offset < 0 ? "-" : "+"}${hhmm}`, days: SYNTHETIC_DAYS, fear });
  const body = toNightly(member);
  const below = new Set(
    [...readings(body.rmssd)].filter(([, r]) => r.state === "suppressed" || r.state === "strained").map(([night]) => night),
  );
  const last = [...body.rmssd.keys()].sort().at(-1)!;
  const first = addDays(last, -(SYNTHETIC_DAYS - 1));

  // Real coins at their real daily closes, so their charts show the trades where they would have landed.
  // If the price service is unreachable, the trader keeps to SOL and its placeholder token.
  const tokens: { mint: string; close: Nightly }[] = [];
  for (const mint of [JUP_MINT, BONK_MINT]) {
    try {
      tokens.push({ mint, close: await dailyCloses(mint) });
    } catch {}
  }
  const acts = valueActs(syntheticWalletActs({ last, days: SYNTHETIC_DAYS, offsetMinutes: offset, solClose: closes, below, tokens }), closes);
  await setSyntheticWallet(true);
  return buildView({ source: "synthetic", address: "synthetic", now, offset, acts, complete: true, first, last });
}
