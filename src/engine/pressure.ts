import { ASSESSMENT_SWC, banded, cv7 } from "./hrv";
import { addDays, type Nightly } from "./nights";

/**
 * Pressure: how much the reader is under, now, read from their data alone.
 *
 * Three parts, each 0–100, where 0 is an ordinary day for this reader:
 *
 *   Body        HRV's 7-day average below its normal, CV above (or, under a
 *               suppressed HRV, away from normal either way: fatigue), resting
 *               heart rate above — in the normal range's own spread: 0 at the
 *               normal or better, 50 at the edge of the normal range (1 SD),
 *               100 at 2 SD.
 *   Positions   the state of the trades, live from the chain: how far the
 *               coins are underwater against their cost, how much of their
 *               gain has been given back from the 30-day high, the last 7
 *               days' realised losses, the day's pace against the usual day,
 *               a night on-chain past midnight, failed transactions. Each is
 *               0 when absent (not underwater, no losses) and otherwise ranked
 *               against the reader's own bad days in the last 90 — so a small
 *               dip ranks low even when most days had none.
 *   Market      DVOL's last week and SOL's last week of swings, against their
 *               own year: 0 at the year's median or calmer, 100 at its worst.
 *               Context: nobody chooses it.
 *
 * An ordinary day scores near 0 on all three. Calibrated after a first
 * version that ranked everything as a percentile read "Rising" on 61% of
 * days: a median day sat at 50, right on the threshold.
 *
 * Total = Body 40% · Positions 40% · Market 20%, except that one extreme part
 * leads: the total is never below 0.8 × the highest part, and the body part
 * never below 0.8 × its highest signal. Levels: Low under 35, Rising to 60, High
 * from 60.
 *
 * Every number comes from data the app already reads. Nothing is asked of
 * the reader, and only days up to and including the one scored are used.
 */

export interface PressureInput {
  /** ln rMSSD by night. */
  ln?: Nightly;
  rhr?: Nightly;
  /** Coins against their cost at the day's close, signed: −0.18 is 18% underwater (`cost.ts`). */
  water?: Nightly;
  /** USD realised by each night's sales. */
  realised?: Nightly;
  /** Share of the wallet moved, each night. */
  share?: Nightly;
  /** 1 when anything was signed between midnight and 05:00. */
  awake?: Nightly;
  failed?: Nightly;
  dvol?: Nightly;
  /** SOL's daily close. */
  sol?: Nightly;
}

export type PressureKey = "hrv" | "cv" | "rhr" | "underwater" | "givenBack" | "losses" | "pace" | "lateNight" | "failed" | "dvol" | "swings";

export interface PressureDay {
  night: string;
  total: number;
  level: "low" | "rising" | "high";
  parts: { body: number | null; positions: number | null; market: number | null };
  /** Every signal's score and its raw value, highest score first. */
  signals: { key: PressureKey; score: number; value: number }[];
}

export const WEIGHTS = { body: 0.4, positions: 0.4, market: 0.2 } as const;
/** One extreme signal or part leads: never less than this share of the highest. */
const LEAD = 0.8;
/** Levels: a single signal at its worst (100 → part 80 → total 64) reads High. */
export const RISING = 35;
export const HIGH = 60;
const WINDOW = 90;
const YEAR = 365;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Where `x` ranks among `past`, 0–100 (ties count half). */
function rank(x: number, past: number[]): number | null {
  if (past.length < 14) return null;
  let below = 0;
  for (const v of past) below += v < x ? 1 : v === x ? 0.5 : 0;
  return (100 * below) / past.length;
}

/** The last `n` values before `night`, oldest first. */
function before(m: Nightly, night: string, n: number): number[] {
  const out: number[] = [];
  for (let k = n; k >= 1; k--) {
    const v = m.get(addDays(night, -k));
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** A signed series in the normal range's own spread: how far the 7-day value sits from the 60-day mean, in SDs. */
function spreadZ(series: Nightly, opts: { short?: number } = {}): Nightly {
  const out: Nightly = new Map();
  for (const [night, b] of banded(series, { swc: ASSESSMENT_SWC, ...opts })) {
    const m = (b.low + b.high) / 2;
    const sd = (b.high - b.low) / (2 * ASSESSMENT_SWC);
    if (sd > 0) out.set(night, (b.baseline - m) / sd);
  }
  return out;
}

/**
 * A signal that is nothing when absent: 0 at zero, else its rank among the
 * reader's own bad days (those above zero) in the last 90. With fewer than
 * five such days to compare against, a middling 50.
 */
function presence(x: number | undefined, m: Nightly | undefined, night: string): number | null {
  if (x === undefined || !m) return null;
  if (x <= 0) return 0;
  const bad = before(m, night, WINDOW).filter((v) => v > 0);
  if (bad.length < 5) return 50;
  let below = 0;
  for (const v of bad) below += v < x ? 1 : v === x ? 0.5 : 0;
  return (100 * below) / bad.length;
}

/** Body: SDs worse than normal, as 0 (normal or better), 50 (the edge of normal), 100 (2 SD). */
const sdScore = (z: number) => Math.max(0, Math.min(100, 50 * z));

export function pressure(i: PressureInput, nights: string[]): Map<string, PressureDay> {
  // Body: below-normal HRV, above-normal CV and resting heart rate, all as "more pressure" when positive.
  const hrvZ = i.ln ? new Map([...spreadZ(i.ln)].map(([k, v]) => [k, -v])) : undefined;
  // CV up is a stressor; CV down is calm only when HRV is normal. Under a suppressed HRV a steady CV is
  // accumulated fatigue, so there it counts whichever way it moves.
  const cvRaw = i.ln ? spreadZ(cv7(i.ln), { short: 1 }) : undefined;
  const cvZ = cvRaw && hrvZ ? new Map([...cvRaw].map(([k, v]) => [k, (hrvZ.get(k) ?? 0) > 1 ? Math.abs(v) : v])) : cvRaw;
  const rhrZ = i.rhr?.size ? spreadZ(i.rhr) : undefined;

  // Positions, as series so each night can rank against the ones before it.
  const underwater: Nightly | undefined = i.water ? new Map([...i.water].map(([k, v]) => [k, Math.max(0, -v)])) : undefined;
  const givenBack: Nightly = new Map();
  if (i.water) {
    for (const [k, v] of i.water) {
      const peak = Math.max(v, ...before(i.water, k, 30));
      givenBack.set(k, Math.max(0, peak - v));
    }
  }
  const losses: Nightly = new Map();
  if (i.realised) {
    const keys = [...new Set([...i.realised.keys(), ...nights])].sort();
    for (const k of keys) {
      const week = [k, ...Array.from({ length: 6 }, (_, d) => addDays(k, -d - 1))].reduce((s, d) => s + (i.realised!.get(d) ?? 0), 0);
      losses.set(k, Math.max(0, -week));
    }
  }
  const pace: Nightly = new Map();
  if (i.share) {
    for (const [k, v] of i.share) {
      const past = before(i.share, k, 60);
      const usual = past.length >= 14 ? mean(past) : 0;
      if (usual > 0) pace.set(k, Math.max(0, v / usual - 1));
    }
  }

  // Market: the last week against its year.
  const weekMean = (m: Nightly, night: string) => {
    const xs = [m.get(night), ...before(m, night, 6)].filter((v): v is number => v !== undefined);
    return xs.length >= 4 ? mean(xs) : undefined;
  };
  const swings: Nightly = new Map();
  if (i.sol) {
    const d = [...i.sol.keys()].sort();
    for (let k = 1; k < d.length; k++) swings.set(d[k], Math.abs(Math.log(i.sol.get(d[k])! / i.sol.get(d[k - 1])!)));
  }
  const yearRank = (m: Nightly | undefined, night: string): { score: number | null; value: number } | null => {
    if (!m?.size) return null;
    const now = weekMean(m, night);
    if (now === undefined) return null;
    const past = [...m.keys()].filter((k) => k < night && k >= addDays(night, -YEAR)).map((k) => weekMean(m, k)).filter((v): v is number => v !== undefined);
    const r = rank(now, past);
    // Only the worse half of the year counts: the median day or calmer is 0.
    return { score: r === null ? null : Math.max(0, 2 * (r - 50)), value: now };
  };

  const out = new Map<string, PressureDay>();
  for (const night of nights) {
    const signals: PressureDay["signals"] = [];
    const add = (key: PressureKey, score: number | null, value: number | undefined) => {
      if (score !== null && value !== undefined) signals.push({ key, score, value });
    };

    // Body: how far worse than normal, in the normal range's own spread.
    for (const [key, m] of [["hrv", hrvZ], ["cv", cvZ], ["rhr", rhrZ]] as const) {
      const x = m?.get(night);
      if (x !== undefined) add(key, sdScore(x), x);
    }
    add("underwater", presence(underwater?.get(night), underwater, night), underwater?.get(night));
    add("givenBack", presence(givenBack.get(night), i.water ? givenBack : undefined, night), givenBack.get(night));
    add("losses", presence(losses.get(night), i.realised ? losses : undefined, night), losses.get(night));
    add("pace", presence(pace.get(night), i.share ? pace : undefined, night), pace.get(night));
    add("lateNight", presence(i.awake?.get(night), i.awake, night), i.awake?.get(night));
    add("failed", presence(i.failed?.get(night), i.failed, night), i.failed?.get(night));
    const dv = yearRank(i.dvol, night);
    if (dv) add("dvol", dv.score, dv.value);
    const sw = yearRank(i.sol ? swings : undefined, night);
    if (sw) add("swings", sw.score, sw.value);

    // A part is its signals' mean. In the body one signal at its worst leads — HRV far below normal is
    // not made ordinary by a CV that happens to be — but not in positions, whose six signals are each
    // ranked against the reader's own bad days, so one of them is near its worst on most days.
    const part = (keys: PressureKey[], lead: boolean) => {
      const xs = signals.filter((s) => keys.includes(s.key)).map((s) => s.score);
      return xs.length ? (lead ? Math.max(mean(xs), LEAD * Math.max(...xs)) : mean(xs)) : null;
    };
    const parts = {
      body: part(["hrv", "cv", "rhr"], true),
      positions: part(["underwater", "givenBack", "losses", "pace", "lateNight", "failed"], false),
      market: part(["dvol", "swings"], false),
    };
    const present = (Object.keys(parts) as (keyof typeof parts)[]).filter((k) => parts[k] !== null);
    if (!present.length) continue;
    const w = present.reduce((s, k) => s + WEIGHTS[k], 0);
    const weighted = present.reduce((s, k) => s + WEIGHTS[k] * parts[k]!, 0) / w;
    const top = Math.max(...present.map((k) => parts[k]!));
    const total = Math.round(Math.max(weighted, LEAD * top));
    out.set(night, {
      night,
      total,
      level: total >= HIGH ? "high" : total >= RISING ? "rising" : "low",
      parts,
      signals: signals.sort((a, b) => b.score - a.score),
    });
  }
  return out;
}
