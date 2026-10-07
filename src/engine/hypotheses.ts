import { addDays, weekday, type Nightly } from "./nights";
import { bootstrapInterval, effect, race, type Race, type Row } from "./stats";

/**
 * What Exposure is allowed to ask, written down before any data is seen.
 *
 * ── Why not "trading late costs you sleep" ───────────────────────────────
 * The first registry led with it, and it was the wrong lead: everyone already
 * believes it, the answer changes nothing, and every path in it runs through
 * sleep, so it reduces to "short sleep lowers HRV". Those questions are kept,
 * as exploratory, and the primaries are replaced by three that nobody can
 * answer without joining a body, a market and a wallet — and whose answers
 * someone would act on.
 *
 * ── The frame: Altini's, pointed at trading ──────────────────────────────
 * In HRV-guided training, the body's state decides the day's load and the
 * load's history explains the body's state. Trading has both halves. The
 * market supplies an external load nobody chooses (its volatility, and above
 * all its expected volatility — crypto's VIX, DVOL). The wallet supplies an
 * internal load the person does choose (how much they trade relative to their
 * own normal). And the body is read the Altini way, by baseline and CV against
 * its own 60-night band (`hrv.ts`), not by the night's number.
 *
 *   1. fear-or-turbulence Does the body's variability follow the volatility
 *                         the market EXPECTS, or the volatility it DELIVERED?
 *                         Both in one model, and the gap between them.
 *                         External load → body, weekly.
 *   2. readiness-trading  Do you trade differently on mornings your body is
 *                         below its normal? Body → behaviour, daily. The
 *                         Altini question itself: what state are you in when
 *                         you take risk.
 *   3. trading-load       Is a week of trading well above your own normal —
 *                         measured as the share of the wallet put at stake,
 *                         not the number of transactions — followed by an
 *                         unsettled body? Internal load → body, weekly, with
 *                         the market's fear held fixed.
 *
 * Each has an obvious confounder, and the design names it. The market drives
 * both the body and the trading, so market fear is a covariate wherever
 * trading is on one side. Six months of two slow series will correlate by drift
 * alone, so weekly questions carry a linear trend. The weekly cycle is removed
 * from nightly ones.
 *
 * The three split the 5% between them (98.3% intervals). Everything else is
 * exploratory, labelled as such, and never worded as a finding.
 */

/**
 * `grain:name`. Nightly keys are the evening's date; weekly keys the Monday.
 * `you:` is a reading of the reader built from more than one source (Pressure).
 */
export type SeriesKey = `${"market" | "wallet" | "health" | "week" | "you"}:${string}`;

export type Data = Partial<Record<SeriesKey, Nightly>>;

export type Link = "market→body" | "body→behaviour" | "behaviour→body" | "market→behaviour";

export interface Hypothesis {
  id: string;
  tier: "primary" | "exploratory";
  grain: "night" | "week";
  link: Link;
  exposure: SeriesKey;
  outcome: SeriesKey;
  /** Looked up at the outcome's night or week. */
  covariates: SeriesKey[];
  /** Exposure this many nights (or weeks) before the outcome. */
  lag: number;
  /** Binary compares nights at or over the threshold with the rest. */
  threshold?: number;
  /** Continuous effects are reported per this many units of exposure. */
  per?: number;
  /**
   * A second exposure on the same scale, raced against the first in one model
   * (`stats.race`). The result says which of the two the outcome follows.
   */
  versus?: SeriesKey;
  /** Run the reverse direction as a check. */
  reverse: boolean;
  question: string;
  /** Interval confidence, when a family of questions splits the 5% (`coinQuestion`). */
  confidence?: number;
  /** What a generated question is about, in a word: a coin's symbol. */
  subject?: string;
}

export const MIN = { night: 56, week: 26 } as const;
/** Bootstrap block: a week of nights, a month of weeks. */
const BLOCK = { night: 7, week: 4 } as const;
/** A binary comparison needs this many rows on each side. */
export const MIN_EACH_SIDE = 8;

/** The day's market, as a trader waking up would find it. */
const MARKET_DAY: SeriesKey[] = ["market:dvol", "market:shock"];

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "fear-or-turbulence",
    tier: "primary",
    grain: "week",
    link: "market→body",
    exposure: "week:expected",
    versus: "week:realised",
    outcome: "week:cv",
    covariates: ["week:strain"],
    lag: 0,
    per: 10,
    reverse: false,
    question: "Does your HRV follow the volatility the market expects, or the volatility it actually delivered?",
  },
  {
    id: "readiness-trading",
    tier: "primary",
    grain: "night",
    link: "body→behaviour",
    exposure: "health:below",
    outcome: "wallet:share",
    covariates: MARKET_DAY,
    lag: 1,
    threshold: 1,
    reverse: true,
    question: "On mornings your HRV baseline is below your normal, do you put more or less of your wallet at stake — whatever the market is doing?",
  },
  {
    id: "trading-load",
    tier: "primary",
    grain: "week",
    link: "behaviour→body",
    exposure: "week:loadRatio",
    outcome: "week:cv",
    covariates: ["week:dvol", "week:strain"],
    lag: 1,
    per: 1,
    reverse: true,
    question: "After a week of putting far more of your wallet at stake than usual, is your HRV less stable — at the same level of market fear?",
  },

  // ── fear, from other angles ──
  ex("premium-cv", "week", "market→body", "week:vrp", "week:cv", ["week:strain"], { per: 10 },
    "In weeks when fear runs ahead of what the market delivers, is your HRV less stable?"),
  ex("greed-cv", "week", "market→body", "week:fng", "week:cv", ["week:strain"], { per: 25 },
    "Is your HRV less stable in weeks of greed, or weeks of fear?"),
  ex("greed-share", "night", "market→behaviour", "market:fng", "wallet:share", ["market:dvol"], { per: 25 },
    "Do you put more of your wallet at stake on greedy days, at the same volatility?"),
  ex("fear-baseline", "week", "market→body", "week:dvol", "week:baseline", ["week:strain"], { per: 10 },
    "Does priced fear move your HRV baseline, rather than its variability?"),

  // ── body state → behaviour ──
  ex("strained-trading", "night", "body→behaviour", "health:strained", "wallet:share", MARKET_DAY, { threshold: 1, lag: 1 },
    "On mornings your baseline is low and your CV high, do you put more or less at stake?"),
  ex("below-count", "night", "body→behaviour", "health:below", "wallet:swaps", MARKET_DAY, { threshold: 1, lag: 1 },
    "On mornings below your normal, do you make more swaps, whatever their size?"),
  ex("below-failed", "night", "body→behaviour", "health:below", "wallet:failed", MARKET_DAY, { threshold: 1, lag: 1 },
    "Do more of your transactions fail on mornings you are below your normal — chasing, or rushing?"),
  ex("below-late", "night", "body→behaviour", "health:below", "wallet:late", MARKET_DAY, { threshold: 1, lag: 1 },
    "Are you on-chain later at night on days that started below your normal?"),

  // ── your position → body, added 5 October 2026 ──
  // Underwater: the wallet's coins 5% or more below their average cost at the
  // day's close (`cost.ts`; the series is how many points below). The market's
  // own day is held fixed, so this asks whether being down on YOUR position
  // shows in the body beyond what the market's moves do to everyone. HRV is
  // recorded during sleep, so the position is the day's, and the HRV the
  // night after it: a coin cannot weigh on someone asleep.
  ex("underwater-hrv", "night", "market→body", "wallet:underwater", "health:ln", MARKET_DAY, { threshold: 5 },
    "After a day your coins end 5% or more below what they cost you, is your HRV lower that night, beyond what the market's day explains?"),

  // ── your pressure → your results, added 5 October 2026 ──
  // Pressure (`pressure.ts`) the morning of a trade, against the trade's
  // signed move over the next day (`performance.ts`), averaged over the
  // night's trades. Added after a first look at synthetic trades found
  // nothing — as it should, since their timing is random — so exploratory.
  ex("pressure-results", "night", "body→behaviour", "you:pressure", "wallet:result", MARKET_DAY, { per: 50, lag: 1 },
    "On mornings your Pressure is higher, do your trades that day go worse over the next day, beyond what the market's day explains?"),

  // ── your balance → body, added 6 October 2026 ──
  // What the market did to the wallet's coins that day (`cost.ts`
  // returnSeries: price only, in percent; in dollars, the balance's change)
  // against that night's HRV, the market's own day held fixed, as underwater.
  // HRV is recorded during sleep (WHOOP, Apple Watch, most wearables), so the
  // question is what the day before does to the night, not to a morning.
  ex("balance-hrv", "night", "market→body", "wallet:pnl", "health:ln", MARKET_DAY, { per: 5 },
    "After a day your coins gain 5% in value, is your HRV different that night, beyond what the market's day explains?"),

  // ── the first registry's questions, demoted ──
  ex("surprise-hrv", "night", "market→body", "market:shock", "health:ln", ["health:strain"], { per: 2 },
    "After a day SOL moved twice its usual amount, is your HRV lower that night?"),
  ex("awake-hrv", "night", "behaviour→body", "wallet:awake", "health:ln", ["health:strain"], { threshold: 1 },
    "On nights you are on-chain past midnight, is your HRV lower?"),
  ex("surprise-awake", "night", "market→behaviour", "market:shock", "wallet:awake", [], { per: 2 },
    "Are you more likely to be on-chain past midnight after a surprising day?"),
];

/**
 * ── each coin you hold → body, added 6 October 2026 ──
 * The same question once per coin held, the largest COIN_QUESTIONS by value:
 * the coin's daily move against that night's HRV, the market's day held fixed.
 * "Which of my coins" is one question asked k ways, so the k split the 5%
 * between them, as the primaries do; asked singly, one coin in twenty would
 * come out by chance.
 */
export const COIN_QUESTIONS = 8;

export function coinQuestion(mint: string, symbol: string, k: number): Hypothesis {
  return {
    ...ex(`coin-hrv:${mint}`, "night", "market→body", `market:coin:${mint}`, "health:ln", MARKET_DAY, { per: 5 },
      `After a day ${symbol} rises 5%, is your HRV different that night, beyond what the market's day explains?`),
    confidence: 1 - 0.05 / k,
    subject: symbol,
  };
}

export const isCoinQuestion = (id: string) => id.startsWith("coin-hrv:");

function ex(
  id: string,
  grain: "night" | "week",
  link: Link,
  exposure: SeriesKey,
  outcome: SeriesKey,
  covariates: SeriesKey[],
  opts: { threshold?: number; per?: number; lag?: number },
  question: string,
): Hypothesis {
  return {
    id, tier: "exploratory", grain, link, exposure, outcome, covariates,
    lag: opts.lag ?? 0, threshold: opts.threshold, per: opts.per, reverse: false, question,
  };
}

export function confidenceFor(h: Hypothesis): number {
  if (h.confidence !== undefined) return h.confidence;
  const primaries = HYPOTHESES.filter((x) => x.tier === "primary").length;
  return h.tier === "primary" ? 1 - 0.05 / primaries : 0.95;
}

export type Result =
  | { status: "missing"; series: SeriesKey[] }
  | { status: "collecting"; have: number; need: number }
  /** Enough rows, but almost all on one side — e.g. never below baseline. */
  | { status: "no-contrast"; exposed: number; n: number }
  | {
      status: "race";
      race: Race;
      confidence: number;
      n: number;
      /**
       * `first`/`second` when the gap excludes zero; `unclear` when the
       * outcome follows market volatility but the data cannot say which kind;
       * `neither` when it follows neither.
       */
      verdict: "first" | "second" | "unclear" | "neither";
    }
  | {
      status: "result";
      /** Outcome units, per `per` of exposure, or exposed minus not. */
      effect: number;
      interval: [number, number];
      confidence: number;
      n: number;
      exposed?: number;
      /** The interval excludes zero. */
      detected: boolean;
      /**
       * The reverse direction came out just as clearly. For a market exposure
       * that means something else drives both, since nobody moves DVOL; the
       * forward result is then not shown as a finding.
       */
      suspect: boolean;
    };

/**
 * Pair exposure `lag` steps before each outcome. A negative lag is the reverse
 * check; `control` then adds the exposure at that many steps before as a
 * covariate, so the reverse asks whether the outcome predicts the exposure
 * beyond the exposure's own persistence.
 */
function rows(h: Hypothesis, data: Data, lag: number, control: number | null = null): Row[] {
  const x = data[h.exposure]!;
  const y = data[h.outcome]!;
  const covs = h.covariates.map((k) => data[k]!);
  const step = h.grain === "week" ? 7 : 1;
  const out: Row[] = [];
  const keys = [...y.keys()].sort();
  const origin = keys[0];
  for (const key of keys) {
    const xv = x.get(addDays(key, -lag * step));
    const cv = covs.map((c) => c.get(key));
    if (xv === undefined || cv.some((v) => v === undefined)) continue;
    const scale = (v: number) => (h.threshold !== undefined ? (v >= h.threshold ? 1 : 0) : v / (h.per ?? 1));
    const scaled = scale(xv);
    let held: number[] = [];
    if (control !== null) {
      const c = x.get(addDays(key, -control * step));
      if (c === undefined) continue;
      held = [scale(c)];
    }
    let x2: number | undefined;
    if (h.versus) {
      const v = data[h.versus]!.get(addDays(key, -lag * step));
      if (v === undefined) continue;
      x2 = v / (h.per ?? 1);
    }
    // Weekly: a linear trend in years, so six months of drift is not a finding.
    const trend = h.grain === "week"
      ? [(Date.parse(key) - Date.parse(origin)) / (365 * 86_400_000)]
      : [];
    out.push({
      x: scaled,
      x2,
      y: y.get(key)!,
      weekday: h.grain === "night" ? weekday(key) : null,
      covariates: [...(cv as number[]), ...trend, ...held],
    });
  }
  return out;
}

export function test(h: Hypothesis, data: Data, seed = 1): Result {
  const needed = [h.exposure, ...(h.versus ? [h.versus] : []), h.outcome, ...h.covariates];
  const missing = needed.filter((k) => !data[k]);
  if (missing.length) return { status: "missing", series: missing };

  const need = MIN[h.grain];
  const forward = rows(h, data, h.lag);
  if (forward.length < need) return { status: "collecting", have: forward.length, need };

  let exposed: number | undefined;
  if (h.threshold !== undefined) {
    exposed = forward.filter((r) => r.x === 1).length;
    if (exposed < MIN_EACH_SIDE || forward.length - exposed < MIN_EACH_SIDE) {
      return { status: "no-contrast", exposed, n: forward.length };
    }
  }

  const confidence = confidenceFor(h);
  const block = BLOCK[h.grain];

  if (h.versus) {
    const r = race(forward, confidence, { seed, block });
    if (!r) return { status: "collecting", have: forward.length, need };
    const excludes = (i: [number, number]) => i[0] > 0 || i[1] < 0;
    // "Larger" in the direction the two share: if volatility lowers the
    // outcome, the more negative coefficient is the one it follows.
    const sign = Math.sign(r.first.effect + r.second.effect) || 1;
    const verdict = excludes(r.gap.interval)
      ? sign * r.gap.effect > 0 ? "first" : "second"
      : excludes(r.first.interval) || excludes(r.second.interval) ? "unclear" : "neither";
    return { status: "race", race: r, confidence, n: forward.length, verdict };
  }

  const e = effect(forward);
  const interval = bootstrapInterval(forward, confidence, { seed, block });
  if (e === null || interval === null) return { status: "collecting", have: forward.length, need };
  const detected = interval[0] > 0 || interval[1] < 0;

  let suspect = false;
  if (h.reverse && detected) {
    // Body now against exposure later: the same pairing with the lag flipped,
    // holding fixed the exposure that came before. A body state that runs for
    // days would otherwise make any real one-way habit look two-way: the
    // trading sits between two low mornings and seems to predict the second.
    const back = rows(h, data, -Math.max(1, h.lag), Math.max(1, h.lag));
    const bi = back.length >= need ? bootstrapInterval(back, confidence, { seed, block }) : null;
    suspect = bi !== null && (bi[0] > 0 || bi[1] < 0);
  }

  return { status: "result", effect: e, interval, confidence, n: forward.length, exposed, detected, suspect };
}
