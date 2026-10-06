import type { BodyNights } from "./body";
import { ASSESSMENT_SWC, banded, trends, type Arrow, type Position, type Response } from "./engine/hrv";
import { INDICATORS_BY_KEY } from "./engine/market";
import { addDays, type Nightly } from "./engine/nights";
import { premiumSeries } from "./labels";
import type { MarketView } from "./market";
import type { WalletView } from "./wallet";
import { tradingWeek } from "./walletread";

/**
 * Today, read the same way three times — body, market, trading — and joined
 * into one thing to do.
 *
 * Each pillar is three signals against their own normal, shown as arrows, and
 * a named state from them:
 *
 *   body     HRV baseline, resting heart rate, night-to-night CV
 *            → coping, stable, acute, maladaptation, fatigue (`engine/hrv.ts`)
 *   market   expected moves (DVOL), fear (options priced above recent moves,
 *            or a panicking crowd), actual moves (SOL's daily swings)
 *            → calm, braced, euphoric, turbulent
 *   trading  size (share of the wallet moved vs the four weeks before), late
 *            nights (after midnight), churn (swaps and failed transactions)
 *            → steady, quiet, pressing, late, chasing
 *
 * Every "up" or "down" is a 7-day mean outside its own 60-day band, the same
 * banding for all three, so an arrow does not flicker on one odd day.
 *
 * The action comes from a fixed table of body × market. Trading never changes
 * it; it adds the line that says where the reader is working against their
 * own state. Size is the risk budget: a body factor times a volatility
 * factor (the past year's median DVOL over this week's, capped at 1 —
 * volatility targeting, never a reason given here to size up).
 *
 * All suggestions, not financial advice; the screen says so.
 */

export type Tone = "good" | "watch" | "bad" | "neutral";

export const TONE_COLOR: Record<Tone, string> = { good: "#3E9E6E", watch: "#E0A43A", bad: "#C43D4B", neutral: "#8B919C" };

export interface Signal {
  label: string;
  arrow: Arrow | null;
  /** What this arrow means for this signal: HRV up is good, resting heart rate up is not. */
  tone: Tone;
}

export interface Pillar {
  state: string;
  tone: Tone;
  line: string;
  /** The signals behind the state, in a few plain words: what the Today screen shows under it. */
  reason: string;
  signals: Signal[];
}

const sentence = (parts: string[]) => {
  const t = parts.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/* ── Body ─────────────────────────────────────────────────────────────── */

export const BODY: Record<Response, { state: string; tone: Tone; line: string }> = {
  coping: { state: "Coping well", tone: "good", line: "Your body is adapting well." },
  stable: { state: "Stable", tone: "good", line: "Your body is steady." },
  acute: { state: "Acute stress", tone: "watch", line: "Your nights are unsettled: a bad night, travel, or something coming on." },
  maladaptation: { state: "Maladaptation", tone: "bad", line: "Your body is responding badly: HRV down, nights unsettled." },
  fatigue: { state: "Accumulated fatigue", tone: "bad", line: "Your body is run down: HRV below its normal for days." },
};

/** Minutes under the usual band before sleep counts as short: a product choice, so a few minutes do not read as a problem. */
const SLEEP_SHORT_MIN = 30;

export function bodyPillar(body: BodyNights): (Pillar & { response: Response }) | null {
  const t = trends(new Map(body.hrv), body.rhr.length ? new Map(body.rhr) : undefined, { swc: ASSESSMENT_SWC });
  const last = [...t.keys()].sort().at(-1);
  if (!last) return null;
  const x = t.get(last)!;
  const b = BODY[x.response];
  const sl = body.sleep.length ? ([...banded(new Map(body.sleep), { swc: ASSESSMENT_SWC }).values()].at(-1) ?? null) : null;
  const sleepShort = !!sl && sl.position === "below" && (sl.low - sl.baseline) * 60 >= SLEEP_SHORT_MIN;
  const issues = [
    ...(x.hrv === "down" ? ["HRV below your normal"] : []),
    ...(x.rhr === "up" ? ["resting heart rate up"] : []),
    ...(x.cv === "up" ? ["restless nights"] : []),
    ...(sleepShort ? ["sleeping less than usual"] : []),
  ];
  const reason = issues.length ? sentence(issues) : sl ? "Heart and sleep normal for you" : "Heart normal for you";
  const signals: Signal[] = [
    { label: "HRV", arrow: x.hrv, tone: x.hrv === "down" ? "bad" : x.hrv === "up" ? "good" : "neutral" },
    { label: "Resting HR", arrow: x.rhr, tone: x.rhr === "up" ? "bad" : x.rhr === "down" ? "good" : "neutral" },
    { label: "Swings", arrow: x.cv, tone: x.cv === "up" ? "watch" : x.cv === "down" ? "good" : "neutral" },
  ];
  return { ...b, response: x.response, reason, signals };
}

/* ── Market ───────────────────────────────────────────────────────────── */

export type MarketState = "calm" | "braced" | "euphoric" | "turbulent";

const MARKET: Record<MarketState, { state: string; tone: Tone; line: string }> = {
  calm: { state: "Calm", tone: "good", line: "The market is calm." },
  braced: { state: "Nervous", tone: "watch", line: "The market is braced for bigger moves." },
  euphoric: { state: "Greedy", tone: "watch", line: "The crowd is euphoric: complacency, and chasing costs most." },
  turbulent: { state: "Wild", tone: "bad", line: "Prices are swinging more than usual." },
};

const arrowOf = (p: Position | undefined | null): Arrow | null => (!p ? null : p === "above" ? "up" : p === "below" ? "down" : "flat");
const lastBand = (m: Nightly) => [...banded(m).values()].at(-1) ?? null;

export interface MarketRead extends Pillar {
  key: MarketState;
  /** Yesterday's SOL move, and whether it was a big day against the last 30. */
  sol: { price: number; change1d: number | null; big: boolean } | null;
  /** Risk factor from volatility: the past year's median DVOL over this week's, capped at 1. */
  factor: number;
}

export function marketPillar(v: MarketView): MarketRead | null {
  if (!v.dvol) return null;
  const expected = arrowOf(v.dvol.position);

  const prem = premiumSeries(v);
  const premBand = prem.length ? lastBand(new Map(prem)) : null;
  const panic = v.fng !== null && v.fng.value < 25;
  const fear: Arrow | null = panic ? "up" : arrowOf(premBand?.position);

  // SOL's actual swings: |daily log return|, banded like everything else.
  const swings: Nightly = new Map();
  for (let i = 1; i < v.solBars.length; i++) {
    const a = v.solBars[i - 1].close;
    const b = v.solBars[i].close;
    if (a > 0 && b > 0) swings.set(v.solBars[i].day, Math.abs(Math.log(b / a)));
  }
  const actual = arrowOf(lastBand(swings)?.position);

  const greedy = v.fng !== null && v.fng.value > 75;
  const key: MarketState =
    actual === "up" ? "turbulent" : expected === "up" || fear === "up" ? "braced" : greedy ? "euphoric" : "calm";

  const shock = INDICATORS_BY_KEY.shock.compute(v.solBars);
  const lastShock = [...shock.values()].at(-1);

  const year = v.dvolSeries.slice(-365).map((d) => d.value).sort((a, b) => a - b);
  const typical = year.length ? year[year.length >> 1] : v.dvol.value;
  const week = v.dvolSeries.slice(-7).map((d) => d.value);
  const now = week.length ? week.reduce((s, x) => s + x, 0) / week.length : v.dvol.value;

  const issues = [
    ...(expected === "up" ? ["bigger moves expected"] : []),
    ...(fear === "up" ? (panic ? ["the crowd is panicking"] : ["fear rising"]) : []),
    ...(actual === "up" ? ["prices swinging hard"] : []),
    ...(key === "euphoric" ? ["the crowd is greedy"] : []),
  ];
  const reason = issues.length ? sentence(issues) : expected === "down" ? "Smaller moves than usual" : "Usual-sized moves expected";

  return {
    ...MARKET[key],
    key,
    reason,
    signals: [
      { label: "Expected moves", arrow: expected, tone: expected === "up" ? "watch" : expected === "down" ? "good" : "neutral" },
      { label: "Fear", arrow: fear, tone: fear === "up" ? "watch" : "neutral" },
      { label: "Actual moves", arrow: actual, tone: actual === "up" ? "bad" : actual === "down" ? "good" : "neutral" },
    ],
    sol: v.sol ? { price: v.sol.price, change1d: v.sol.change1d, big: lastShock !== undefined && lastShock >= 2 } : null,
    factor: Math.min(1, typical / now),
  };
}

/* ── Trading ──────────────────────────────────────────────────────────── */

export type TradingState = "steady" | "quiet" | "pressing" | "late" | "chasing";

const TRADING: Record<TradingState, { state: string; tone: Tone; line: string }> = {
  steady: { state: "Steady", tone: "good", line: "Your trading is at its usual pace." },
  quiet: { state: "Lighter", tone: "good", line: "You're trading less than usual." },
  pressing: { state: "Heavier", tone: "watch", line: "You're putting more at stake than usual." },
  late: { state: "Late nights", tone: "watch", line: "You're trading after midnight more than usual." },
  chasing: { state: "Chasing", tone: "bad", line: "Bigger and more frequent trades than usual: the shape of chasing." },
};

export interface TradingRead extends Pillar {
  key: TradingState;
  ratio: number | null;
}

export function tradingPillar(w: WalletView): TradingRead {
  const byNight = new Map(w.load.map((p) => [p.night, p]));
  const nights = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => byNight.get(addDays(w.last, -from - i))).filter((p) => p !== undefined);
  const week = nights(0, 7);
  const before = nights(7, 28);
  const now = (k: "awake" | "swaps" | "failed") => week.reduce((s, p) => s + p[k], 0);
  const usual = (k: "awake" | "swaps" | "failed") => (before.length ? (before.reduce((s, p) => s + p[k], 0) / before.length) * 7 : 0);

  const tw = tradingWeek(w);
  const size: Arrow | null = tw.weight === null ? null : tw.weight === "heavier" ? "up" : tw.weight === "lighter" ? "down" : "flat";
  // Two or more after-midnight nights this week, and more than usual.
  const late: Arrow = now("awake") >= 2 && now("awake") > usual("awake") + 0.5 ? "up" : "flat";
  // Half again as many swaps as usual (at least three), or failures piling up.
  const churnUp =
    (now("swaps") >= 3 && now("swaps") >= 1.5 * Math.max(1, usual("swaps"))) || (now("failed") >= 2 && now("failed") > usual("failed") + 0.5);
  const churn: Arrow = churnUp ? "up" : "flat";

  const key: TradingState =
    size === "up" && churn === "up" ? "chasing" : size === "up" ? "pressing" : late === "up" ? "late" : size === "down" ? "quiet" : "steady";

  const issues = [
    tw.ratio !== null ? `${tw.ratio.toFixed(1)}× your usual week` : "Still learning your usual week",
    ...(late === "up" ? ["trading after midnight"] : []),
    ...(churn === "up" ? ["more trades and failures"] : []),
  ];

  return {
    ...TRADING[key],
    key,
    reason: sentence(issues),
    ratio: tw.ratio,
    signals: [
      { label: "Size", arrow: size, tone: size === "up" ? "watch" : "neutral" },
      { label: "Late nights", arrow: late, tone: late === "up" ? "watch" : "neutral" },
      { label: "Churn", arrow: churn, tone: churn === "up" ? "watch" : "neutral" },
    ],
  };
}

/* ── The action ───────────────────────────────────────────────────────── */

type B = 0 | 1 | 2;
type M = 0 | 1 | 2;
const bodyRow = (r: Response): B => (r === "coping" || r === "stable" ? 0 : r === "acute" ? 1 : 2);
const marketCol = (m: MarketState): M => (m === "calm" ? 0 : m === "turbulent" ? 2 : 1);

/** The table. `sized` actions get the risk budget appended; the others say what to do instead of how much. */
const TABLE: Record<B, Record<M, { text: string; sized: boolean; tone: Tone }>> = {
  0: {
    0: { text: "Trade as planned", sized: true, tone: "good" },
    1: { text: "Trade as planned, smaller", sized: true, tone: "watch" },
    2: { text: "Trade smaller", sized: true, tone: "watch" },
  },
  1: {
    0: { text: "Avoid big decisions today", sized: true, tone: "watch" },
    1: { text: "Trade smaller, no new bets", sized: true, tone: "watch" },
    2: { text: "Manage open positions only", sized: false, tone: "bad" },
  },
  2: {
    0: { text: "Trade smaller, nothing late at night", sized: true, tone: "bad" },
    1: { text: "Trade smaller, nothing new", sized: true, tone: "bad" },
    2: { text: "Stand aside today", sized: false, tone: "bad" },
  },
};

const BODY_FACTOR: Record<B, number> = { 0: 1, 1: 0.8, 2: 0.6 };

/** What the body alone says for trading: the action table's calm-market column. */
export function bodyAdvice(r: Response): { text: string; tone: Tone } {
  const cell = TABLE[bodyRow(r)][0];
  return { text: cell.text, tone: cell.tone };
}

export interface Action {
  headline: string;
  /** "Usual size", "60% of your usual size", or what to do instead. */
  sizeLine: string;
  tone: Tone;
  /** Position size as a share of usual, when the action is to trade at all. */
  size: number | null;
  why: string;
  /** Where the reader is working against their own state, and other warnings. */
  lines: string[];
}

export function action(body: (Pillar & { response: Response }) | null, market: MarketRead | null, trading: TradingRead | null): Action | null {
  if (!body) return null;
  const b = bodyRow(body.response);
  const m = market ? marketCol(market.key) : 0;
  const cell = TABLE[b][m];
  const size = cell.sized ? Math.max(25, Math.round((100 * BODY_FACTOR[b] * (market?.factor ?? 1)) / 5) * 5) : null;
  const headline = cell.text;
  const sizeLine = size === null ? "No new positions" : size >= 100 ? "Usual size" : `${size}% of your usual size`;

  const whyParts = [body.line];
  if (market) whyParts.push(market.line);
  if (size !== null && market && market.factor < 0.98) whyParts.push("Bigger expected moves mean the same position carries more risk.");

  const lines: string[] = [];
  const rhr = body.signals.find((s) => s.label === "Resting HR")?.arrow;
  if (b === 0 && rhr === "up") lines.push("Your resting heart rate is up. Watch for getting ill.");
  if (trading) {
    const r = trading.ratio !== null ? `${trading.ratio.toFixed(1)}×` : "more than";
    if ((trading.key === "pressing" || trading.key === "chasing") && b > 0) {
      lines.push(`You're trading ${r} your usual while your body is down. Ease off.`);
    } else if ((trading.key === "pressing" || trading.key === "chasing") && m === 2) {
      lines.push(`You're trading ${r} your usual into big swings.`);
    } else if (trading.key === "late" && b > 0) {
      lines.push("Your after-midnight trades are landing on nights your body needs.");
    } else if (trading.key === "chasing") {
      lines.push(`Bigger and more frequent trades than usual (${r} your usual size). Check each one is a plan.`);
    }
  }
  return { headline, sizeLine, tone: cell.tone, size, why: whyParts.join(" "), lines };
}
