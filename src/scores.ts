import type { BodyNights } from "./body";
import type { BodyRead } from "./bodyview";
import { addDays } from "./engine/nights";
import type { MarketView } from "./market";
import type { WalletView } from "./wallet";
import { tradingWeek } from "./walletread";

/**
 * Today's three scores and the risk budget they add up to.
 *
 * ── The scores, each a rank against the reader's own history ─────────────
 * No population norms and no hidden weights: each score says where today sits
 * in the reader's own record, so it can be checked by hand.
 *
 *   Recovery   last night's HRV, as a percentile of the 60 nights before it.
 *              72 means a higher HRV than on 72% of those nights. One night,
 *              like WHOOP's recovery; the multi-day trend enters the budget.
 *   Sleep      last night's hours as a percentage of the median of the 60
 *              nights before, capped at 100: sleep against your own usual.
 *   Market     this week's mean DVOL — Bitcoin's 30-day implied volatility —
 *   stress     as a percentile of the past year's days. 80 means the options
 *              market expects bigger moves than on 80% of days this year.
 *
 * Colour bands follow WHOOP's, so a reader who knows one reads the other:
 * recovery green from 67, red to 33; sleep green from 85, red under 70.
 * Market stress runs the other way: red from 67.
 *
 * ── The risk budget ───────────────────────────────────────────────────────
 * A position size, as a share of the reader's usual, from two factors:
 *
 *   market  the past year's median DVOL over this week's, capped at 1. If the
 *           options market expects moves 1.4× bigger than a typical day, the
 *           same position carries 1.4× the risk, so 1/1.4 ≈ 70% of it carries
 *           the usual risk. Volatility targeting, the standard way to hold
 *           risk constant. Never above 1: a calm market is not a reason given
 *           here to size up.
 *   body    the lower of last night (recovery green 1, yellow 0.85, red 0.7)
 *           and the multi-day state the engine reads (`engine/hrv.ts`: below
 *           normal 0.6, unsettled 0.8, otherwise 1). A product choice, drawn
 *           from HRV-guided training's "lower load on a low day", and the part
 *           the questions in Patterns exist to test against the reader's own
 *           trading.
 *
 * Budget = body × market, rounded to 5%, never under 25%. A suggestion, not
 * financial advice, and the screen says so.
 */

export type Band = "green" | "yellow" | "red";

export const BAND_COLOR: Record<Band, string> = { green: "#3E9E6E", yellow: "#E0A43A", red: "#C43D4B" };

export interface Scores {
  recovery: { pct: number; band: Band; night: string; hrv: number } | null;
  sleep: { pct: number; band: Band; hours: number; usual: number } | null;
  stress: { pct: number; band: Band; dvol: number; typical: number } | null;
  budget: { pct: number; band: Band; why: string; notes: string[] } | null;
}

/** Percentile rank of `v` in `xs`: the share below it, ties counted half. 0–100. */
function rank(xs: number[], v: number): number {
  let below = 0;
  let equal = 0;
  for (const x of xs) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return Math.round((100 * (below + equal / 2)) / xs.length);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The 60 nights before `night` that have a value. */
const before60 = (pts: [string, number][], night: string) =>
  pts.filter(([k]) => k < night && k >= addDays(night, -60)).map(([, v]) => v);

export function scores(body: BodyNights | null, read: BodyRead | null, market: MarketView | null, wallet: WalletView | null): Scores {
  let recovery: Scores["recovery"] = null;
  let sleep: Scores["sleep"] = null;
  let stress: Scores["stress"] = null;

  if (body && body.hrv.length) {
    const [night, hrv] = body.hrv.at(-1)!;
    const prev = before60(body.hrv, night);
    if (prev.length >= 30) {
      const pct = rank(prev, hrv);
      recovery = { pct, band: pct >= 67 ? "green" : pct >= 34 ? "yellow" : "red", night, hrv };
    }
  }
  if (body && body.sleep.length) {
    const [night, hours] = body.sleep.at(-1)!;
    const prev = before60(body.sleep, night);
    if (prev.length >= 30) {
      const usual = median(prev);
      const pct = Math.min(100, Math.round((100 * hours) / usual));
      sleep = { pct, band: pct >= 85 ? "green" : pct >= 70 ? "yellow" : "red", hours, usual };
    }
  }

  let marketFactor = 1;
  let typical = 0;
  let dvolWeek = 0;
  if (market && market.dvolSeries.length >= 60) {
    const year = market.dvolSeries.slice(-365).map((d) => d.value);
    const week = market.dvolSeries.slice(-7).map((d) => d.value);
    dvolWeek = week.reduce((a, b) => a + b, 0) / week.length;
    typical = median(year);
    const pct = rank(year, dvolWeek);
    stress = { pct, band: pct >= 67 ? "red" : pct >= 34 ? "yellow" : "green", dvol: dvolWeek, typical };
    marketFactor = Math.min(1, typical / dvolWeek);
  }

  let budget: Scores["budget"] = null;
  if (recovery && read?.latest) {
    const daily = recovery.band === "green" ? 1 : recovery.band === "yellow" ? 0.85 : 0.7;
    const st = read.latest.state;
    const trend = st === "suppressed" || st === "strained" ? 0.6 : st === "perturbed" ? 0.8 : 1;
    const bodyFactor = Math.min(daily, trend);
    const pct = Math.max(25, Math.round((100 * bodyFactor * marketFactor) / 5) * 5);

    const parts: string[] = [];
    if (trend < 1 && trend <= daily) {
      parts.push(trend === 0.6 ? "Your body has been below its normal for several days." : "Your nights have been unsettled.");
    } else if (daily < 1) {
      parts.push(recovery.band === "red" ? "Last night's recovery was low." : "Last night's recovery was middling.");
    }
    if (marketFactor < 0.98) {
      parts.push(`Options price moves ${(dvolWeek / typical).toFixed(1)}× a typical day this year, so the same position carries more risk.`);
    }
    const why = parts.length ? parts.join(" ") : "You're recovered, and the market is no wilder than usual.";

    const notes: string[] = [];
    if (sleep?.band === "red") {
      notes.push(`You slept ${sleep.hours.toFixed(1)} h, well under your usual ${sleep.usual.toFixed(1)} h. Skip late-night trades.`);
    }
    const f = market?.fng?.value;
    if (f !== undefined && f > 75) notes.push(`The crowd is euphoric (Fear & Greed ${f}). Stick to your plan; chasing costs most here.`);
    if (f !== undefined && f < 25) notes.push(`The crowd is panicking (Fear & Greed ${f}). Expect sharp moves both ways.`);
    const tw = wallet ? tradingWeek(wallet) : null;
    if (tw?.weight === "heavier" && tw.ratio !== null) notes.push(`You're already trading ${tw.ratio.toFixed(1)}× your usual this week.`);

    budget = { pct, band: pct >= 85 ? "green" : pct >= 60 ? "yellow" : "red", why, notes };
  }

  return { recovery, sleep, stress, budget };
}
