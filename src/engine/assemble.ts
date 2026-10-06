import type { Data } from "./hypotheses";
import { lnRmssd, readings, stateSeries } from "./hrv";
import { INDICATORS_BY_KEY, type Bar } from "./market";
import type { Nightly } from "./nights";
import { parkinson } from "./vol";
import { valueActs, walletNights, type WalletAct } from "./wallet";
import { loadRatio, weeklyCv, weeklyMean, weeklyRealisedVol, weeklySum } from "./weeks";

/**
 * Everything the registry asks about, built from the raw inputs in one place.
 *
 * Any input may be absent. A reader with no wearable still gets every market
 * and wallet series, and the registry answers "missing" for the questions that
 * need a body rather than failing — the page shows which piece to connect.
 */
export interface Inputs {
  /** SOL daily bars: what a SOL holder lived through. */
  sol: Bar[];
  /** BTC daily bars, for BTC's realised volatility against its own DVOL. */
  btc?: Bar[];
  /** BTC DVOL daily close. */
  dvol?: Nightly;
  /** Our SOL index, as stored day by day since it started (`vol.ts`). */
  solIndex?: Nightly;
  /** Crypto Fear & Greed, 0–100. */
  fng?: Nightly;
  wallet?: { acts: WalletAct[]; offsetMinutes: number; first: string; last: string };
  /** Per night, from the wearable. rMSSD in ms. */
  rmssd?: Nightly;
  strain?: Nightly;
  sleep?: Nightly;
  rhr?: Nightly;
}

/** Weeks of history the SOL index needs before it replaces BTC in the race. */
const SOL_INDEX_WEEKS = 26;

/**
 * Which asset the expected-vs-realised race uses. SOL is the one the reader
 * holds, so SOL once our index has half a year of history; BTC's DVOL and BTC's
 * own realised volatility until then. Never one of each — implied BTC against
 * realised SOL would compare two different assets and call it a finding.
 */
export function raceAsset(i: Inputs): "SOL" | "BTC" | null {
  if (i.solIndex && weeklyMean(i.solIndex).size >= SOL_INDEX_WEEKS) return "SOL";
  return i.dvol && i.btc ? "BTC" : null;
}

export function assemble(i: Inputs): Data {
  const d: Data = {};
  for (const key of ["shock", "return", "abs-return", "range", "drawdown", "vol-7", "rsi-extreme"]) {
    d[`market:${key}`] = INDICATORS_BY_KEY[key].compute(i.sol);
  }
  d["week:rv"] = weeklyRealisedVol(d["market:return"]!);

  if (i.dvol) {
    d["market:dvol"] = i.dvol;
    d["week:dvol"] = weeklyMean(i.dvol);
    if (i.btc) {
      // Implied minus realised over the SAME horizon: DVOL is 30 days, so the
      // realised side is BTC's trailing 30 days (Parkinson, as in the race).
      // Against a single week's returns the gap swings ±25 points on sampling
      // noise alone.
      const rv30 = parkinson(i.btc);
      const vrp: Nightly = new Map();
      for (const [day, iv] of i.dvol) {
        const rv = rv30.get(day);
        if (rv !== undefined) vrp.set(day, iv - rv);
      }
      d["market:vrp"] = vrp;
      d["week:vrp"] = weeklyMean(vrp);
    }
  }

  const asset = raceAsset(i);
  if (asset) {
    const expected = asset === "SOL" ? i.solIndex! : i.dvol!;
    const realised = parkinson(asset === "SOL" ? i.sol : i.btc!);
    d["market:expected"] = expected;
    d["market:realised"] = realised;
    d["week:expected"] = weeklyMean(expected);
    d["week:realised"] = weeklyMean(realised);
  }
  if (i.fng) {
    d["market:fng"] = i.fng;
    d["week:fng"] = weeklyMean(i.fng);
  }

  if (i.wallet) {
    const closes: Nightly = new Map(i.sol.map((b) => [b.day, b.close]));
    const acts = valueActs(i.wallet.acts, closes);
    const w = walletNights(acts, i.wallet.offsetMinutes, i.wallet.first, i.wallet.last);
    d["wallet:awake"] = w.awake;
    d["wallet:late"] = w.late;
    d["wallet:count"] = w.count;
    d["wallet:failed"] = w.failed;
    d["wallet:lastAct"] = w.lastAct;
    d["wallet:swaps"] = w.swaps;
    d["wallet:usd"] = w.usd;
    d["wallet:share"] = w.share;
    // Load is what was at stake, not how many times.
    d["week:load"] = weeklySum(w.share);
    d["week:loadRatio"] = loadRatio(d["week:load"]);
  }

  if (i.rmssd) {
    const ln = lnRmssd(i.rmssd);
    const r = readings(i.rmssd);
    d["health:ln"] = ln;
    d["health:below"] = stateSeries(r, ["suppressed", "strained"]);
    d["health:strained"] = stateSeries(r, ["strained"]);
    d["week:cv"] = weeklyCv(ln);
    d["week:baseline"] = weeklyMean(ln);
  }
  if (i.strain) {
    d["health:strain"] = i.strain;
    d["week:strain"] = weeklyMean(i.strain);
  }
  if (i.sleep) d["health:sleep"] = i.sleep;
  if (i.rhr) d["health:rhr"] = i.rhr;
  return d;
}

