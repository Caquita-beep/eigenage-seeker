import AsyncStorage from "@react-native-async-storage/async-storage";
import { readings } from "./engine/hrv";
import { fetchBars, type Bar } from "./engine/market";
import { addDays, nightOf, type Nightly } from "./engine/nights";
import { syntheticWalletActs } from "./engine/synthetic-wallet";
import { fetchSignedActs, valueActs } from "./engine/wallet";
import { toNightly } from "./engine/whoop/nightly";
import { syntheticMember } from "./engine/whoop/synthetic";
import { SYNTHETIC_DAYS } from "./body";
import { BONK_MINT, dailyCloses, JUP_MINT } from "./coins";
import { buildView, type WalletView } from "./walletview";

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

/** Deletes this wallet's history from the phone, every stored version of it. */
export async function forgetWallet(address: string) {
  generation++;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("wallet:view:") && k.endsWith(`:${address}`));
  await AsyncStorage.multiRemove(keys);
}

export async function loadWallet(address: string): Promise<WalletView> {
  const gen = generation;
  const now = new Date();
  // getTimezoneOffset is minutes BEHIND UTC; the engine wants the offset itself (Ecuador: -300).
  const offset = -now.getTimezoneOffset();
  const since = Math.floor(now.getTime() / 1000) - WINDOW_DAYS * 86_400;

  const [{ acts: raw, complete }, bars] = await Promise.all([
    fetchSignedActs(address, since, 1500, 4),
    fetchBars("SOLUSDT", WINDOW_DAYS + 10),
  ]);
  const closes: Nightly = new Map(bars.map((b) => [b.day, b.close]));
  const acts = valueActs(raw, closes);

  const last = nightOf(Math.floor(now.getTime() / 1000), offset);
  // If the read hit its limit, the series starts at the oldest act fetched:
  // earlier nights were not looked at, and must not read as quiet ones.
  const first =
    complete || !acts.length ? nightOf(since, offset) : nightOf(acts[0].blockTime, offset);
  const view = buildView({ source: "chain", address, now, offset, acts, complete, first, last });
  if (gen === generation) AsyncStorage.setItem(key(address), JSON.stringify(view)).catch(() => {});
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
