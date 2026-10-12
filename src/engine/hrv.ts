import { addDays, type Nightly } from "./nights";

/**
 * The body read the way HRV-guided training reads an athlete: not by the night's
 * number, but by where the week sits against the person's own normal, and how
 * much it jumped around getting there.
 *
 * ── The three numbers ─────────────────────────────────────────────────────
 * All on ln rMSSD. rMSSD is right-skewed and its spread grows with its level;
 * the log makes a 10% drop mean the same thing at 30 ms and at 90 ms.
 *
 *   baseline  — mean of the last 7 nights. One night is mostly noise.
 *   band      — the last 60 nights' mean ± the smallest worthwhile change,
 *               0.5 × their between-night SD. Personal by construction; there
 *               is no population norm in it.
 *   CV        — SD / mean of the last 7 nights, in percent. Plews et al. 2012
 *               found it tracked adaptation in elite triathletes where the mean
 *               did not: the one who ended up non-functionally overreached lost
 *               night-to-night variation well before the mean moved.
 *
 * ── CV is read WITH the baseline, never alone ────────────────────────────
 * A falling CV is good news over a normal baseline (the system is stable) and
 * bad news under a suppressed one (the system has stopped responding). A rising
 * CV flags an acute perturbation — illness, travel, a night out, a bad week —
 * whatever the baseline. So the output is a state from both, not a score.
 *
 * The CV's own "high" and "low" come from the same 60-night band applied to the
 * CV series: high for this person, not high by some threshold that is normal for
 * somebody else.
 */

export const SHORT = 7;
export const LONG = 60;
/** Smallest worthwhile change, in between-night SDs. */
export const SWC = 0.5;

/**
 * The normal range the app's daily assessment reads against: ±1 SD. At the
 * SWC's ±0.5, an ordinary run of noise put 44% of mornings in a strained
 * state (acute, maladaptation or fatigue), so "strained" stopped meaning
 * anything and the advice said "trade smaller" most days. The registered
 * questions keep the SWC: they were written down with it.
 */
export const ASSESSMENT_SWC = 1;

/**
 * The daily assessment (`early`) starts on the second morning and sharpens
 * with every one after, as Elite HRV (an estimate after 2 days, a baseline in
 * about 2 weeks) and Oura (scores from the first night, baselines learned over
 * about 2 weeks, read against the last 2 months) do:
 *
 *   quick    from the 2nd morning: that morning against the mornings before
 *            it, outside the range a new morning falls in 19 times in 20
 *            (QUICK_Z), so a single morning has to be well off to count. One
 *            bad morning is an acute hit, so a quick read says only Acute
 *            stress or Stable.
 *   weekly   once 3 mornings sit before the last week: the week's mean
 *            against those mornings, as the method reads it. The normal is
 *            the up to 60 nights before the week, so a week that drops is not
 *            also dragging its own yardstick down.
 *
 * While there are few nights to measure the day-to-day spread from, it starts
 * from a typical one (PRIOR, as a prior worth PRIOR_NIGHTS nights) and becomes
 * the reader's own as nights add up: half theirs at 8 nights, nine tenths at
 * 60. Until FIRM_NIGHTS the read is early, and the app says so. The CV, with
 * no typical spread to start from, has its own band from a week of CV.
 *
 * The registered questions keep the strict 30 and the window as written:
 * they were written down with it.
 */
export const EARLY_NIGHTS = 7;
export const FIRM_NIGHTS = 14;
/** A morning, against the mornings before it, at the edge of where 19 in 20 new mornings fall. */
export const QUICK_Z = 2;
/** Mornings before the last week, for the weekly read. */
const WEEK_BEFORE = 3;
/** The prior is worth this many nights of the reader's own. */
export const PRIOR_NIGHTS = 7;
/**
 * A typical day-to-day spread to start from: ln rMSSD about 0.15 (HRV moving
 * some 15% from one morning to the next), resting heart rate about 3 bpm.
 */
export const PRIOR = { ln: 0.15, rhr: 3 };

/**
 * χ² with 6 degrees of freedom (a week's 7 nights), at 5% and 95%: how far a
 * week's own spread strays from the usual one by chance alone.
 */
const CHI6 = { lo: 1.635, hi: 12.592 };

export type Position = "below" | "within" | "above";

export type State =
  /** Baseline in band, CV not high. */
  | "coping"
  /** Baseline above band, CV not high. Usually rest or adaptation. */
  | "elevated"
  /** CV high, baseline not below. Something acute is happening. */
  | "perturbed"
  /** Baseline below, CV high. Load and an acute hit together. */
  | "strained"
  /** Baseline below, CV not high. Accumulated load; low CV is not comfort here. */
  | "suppressed";

export interface Reading {
  baseline: number;
  low: number;
  high: number;
  /** NaN in the first mornings of an early read, before there are 5 nights for one. */
  cv: number;
  position: Position;
  cvPosition: Position;
  state: State;
  /** A quick read: one morning against the ones before it (`progressive`). */
  quick?: boolean;
}

function window(series: Nightly, end: string, days: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const v = series.get(addDays(end, -i));
    if (v !== undefined) out.push(v);
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Rolling short mean against a long band, for any nightly series. The same
 * instrument is pointed at the body and at the market (`regime` below), which
 * is the point: one definition of "outside your normal" for both.
 */
export function banded(
  series: Nightly,
  { short = SHORT, long = LONG, swc = SWC, early = false, prior }: { short?: number; long?: number; swc?: number; early?: boolean; prior?: number } = {},
): Map<string, Band> {
  if (early) return progressive(series, { short, long, swc, prior });
  const out = new Map<string, Band>();
  const least = Math.ceil(long * 0.5);
  for (const night of [...series.keys()].sort()) {
    const s = window(series, night, short);
    const l = window(series, night, long);
    // Most of each window present, or the reading is a guess.
    if (s.length < Math.ceil(short * 0.7) || l.length < least) continue;
    const baseline = mean(s);
    const m = mean(l);
    const half = swc * sd(l);
    const position: Position = baseline < m - half ? "below" : baseline > m + half ? "above" : "within";
    out.set(night, { baseline, low: m - half, high: m + half, position });
  }
  return out;
}

export interface Band {
  baseline: number;
  low: number;
  high: number;
  position: Position;
  /** A single morning against the mornings before it, before there is a week to read (`progressive`). */
  quick?: boolean;
  /** The normal the range is around, where it is not the range's middle (`cvBands`). */
  centre?: number;
}

/** The spread, starting from the prior's and becoming the series' own as values add up. */
function spread(xs: number[], prior: number | undefined): number {
  if (prior === undefined) return sd(xs);
  const own = xs.length > 1 ? (xs.length - 1) * sd(xs) ** 2 : 0;
  return Math.sqrt((PRIOR_NIGHTS * prior ** 2 + own) / (PRIOR_NIGHTS + Math.max(0, xs.length - 1)));
}

/** The assessment's reading (`early` above): quick from the 2nd morning, weekly once a few mornings sit before the week. */
function progressive(series: Nightly, { short, long, swc, prior }: { short: number; long: number; swc: number; prior?: number }): Map<string, Band> {
  const out = new Map<string, Band>();
  const position = (v: number, low: number, high: number): Position => (v < low ? "below" : v > high ? "above" : "within");
  for (const night of [...series.keys()].sort()) {
    const s = window(series, night, short);
    const before = window(series, addDays(night, -short), long);
    const least = prior === undefined ? EARLY_NIGHTS : WEEK_BEFORE;
    if (s.length >= Math.ceil(short * 0.7) && before.length >= least) {
      const baseline = mean(s);
      const m = mean(before);
      const half = swc * spread(before, prior);
      out.set(night, { baseline, low: m - half, high: m + half, position: position(baseline, m - half, m + half) });
      continue;
    }
    // Before that: this morning against the ones before it, where a typical spread lets a first read be made.
    if (prior === undefined || short === 1) continue;
    const v = series.get(night)!;
    const earlier = window(series, addDays(night, -1), long);
    if (!earlier.length) continue;
    const m = mean(earlier);
    const half = QUICK_Z * spread(earlier, prior) * Math.sqrt(1 + 1 / earlier.length);
    out.set(night, { baseline: v, low: m - half, high: m + half, position: position(v, m - half, m + half), quick: true });
  }
  return out;
}

/**
 * The assessment's CV against its own normal: is this week's night-to-night
 * swing more (or less) than the usual swing gives in 19 weeks of 20? The usual
 * swing is the SD of ln rMSSD over the nights before the week (started from
 * the typical one, `spread`), and a week's CV strays from it by chance as χ²
 * with 6 degrees of freedom does, so the range is the usual CV times
 * √(χ²/6) at 5% and 95%. Comparing the CV with the CVs of the days before, at
 * ±1 SD, called an ordinary week jumpier than usual about one day in five:
 * those CVs share six of the week's seven nights, and there are few weeks
 * among them. The registered questions keep that method: they were written
 * down with it.
 */
export function cvBands(ln: Nightly, prior?: number): Map<string, Band> {
  const cv = cv7(ln);
  const out = new Map<string, Band>();
  for (const night of [...cv.keys()].sort()) {
    const before = window(ln, addDays(night, -SHORT), LONG);
    if (before.length < (prior === undefined ? EARLY_NIGHTS : WEEK_BEFORE)) continue;
    const usual = (100 * spread(before, prior)) / mean(before);
    const low = usual * Math.sqrt(CHI6.lo / 6);
    const high = usual * Math.sqrt(CHI6.hi / 6);
    const v = cv.get(night)!;
    out.set(night, { baseline: v, low, high, position: v < low ? "below" : v > high ? "above" : "within", centre: usual });
  }
  return out;
}

/** ln rMSSD from rMSSD in ms. */
export function lnRmssd(rmssd: Nightly): Nightly {
  const out: Nightly = new Map();
  for (const [k, v] of rmssd) if (v > 0) out.set(k, Math.log(v));
  return out;
}

/** 7-night CV of ln rMSSD, percent. */
export function cv7(ln: Nightly): Nightly {
  const out: Nightly = new Map();
  for (const night of ln.keys()) {
    const w = window(ln, night, SHORT);
    if (w.length >= 5) out.set(night, (100 * sd(w)) / mean(w));
  }
  return out;
}

export function readings(rmssd: Nightly, { swc = SWC, early = false } = {}): Map<string, Reading> {
  const ln = lnRmssd(rmssd);
  const cv = cv7(ln);
  const base = banded(ln, { swc, early, prior: early ? PRIOR.ln : undefined });
  const cvBand = early ? cvBands(ln, PRIOR.ln) : banded(cv, { short: 1, swc, early });
  const out = new Map<string, Reading>();
  for (const [night, b] of base) {
    const c = cvBand.get(night);
    // Early, the CV has no band of its own for a few nights more than the baseline: read as within until it has.
    if (!c && !early) continue;
    const cvPosition: Position = c ? c.position : "within";
    const state: State =
      b.position === "below"
        ? cvPosition === "above" ? "strained" : "suppressed"
        : cvPosition === "above"
          ? "perturbed"
          : b.position === "above" ? "elevated" : "coping";
    const cvNow = cv.get(night);
    if (cvNow === undefined && !early) continue;
    out.set(night, { baseline: b.baseline, low: b.low, high: b.high, cv: cvNow ?? NaN, position: b.position, cvPosition, state, quick: b.quick });
  }
  return out;
}

/** One state as a 0/1 series, for the question registry. */
export function stateSeries(r: Map<string, Reading>, states: State[]): Nightly {
  const out: Nightly = new Map();
  for (const [k, v] of r) out.set(k, states.includes(v.state) ? 1 : 0);
  return out;
}

/* ── The response: HRV, resting heart rate and CV together ──────────────── */

/**
 * Which way a signal sits against its own band: up, down, or within it.
 * "Up" is not "good" — for resting heart rate and CV it is the warning.
 */
export type Arrow = "up" | "flat" | "down";

/**
 * How the body is responding over the last week, read from three signals
 * against the reader's own 60-night normal: the HRV baseline, resting heart
 * rate's 7-night mean, and the 7-night CV.
 *
 *   maladaptation  HRV down and CV up — a poor response to what is loading
 *                  it; resting heart rate rising alongside confirms it.
 *   fatigue        HRV down, CV not up — accumulated load; a quiet CV under a
 *                  suppressed baseline is a system that has stopped
 *                  responding, not one at rest.
 *   acute          CV up with HRV not down — something short-term: illness
 *                  coming on, travel, a bad night, a load spike.
 *   coping         nothing warning (HRV not down, CV not up, resting heart
 *                  rate not up) and at least one sign of adaptation: HRV
 *                  above its band, CV below it, or resting heart rate below.
 *   stable         none of the above, including resting heart rate up on its
 *                  own, which the arrow shows and the advice names.
 *
 * Without a resting heart rate series the same rules run on HRV and CV alone,
 * and `rhr` is null.
 */
export type Response = "maladaptation" | "fatigue" | "acute" | "coping" | "stable";

export interface Trend {
  hrv: Arrow;
  rhr: Arrow | null;
  cv: Arrow;
  response: Response;
  /** From a single morning (`progressive`): Acute stress or Stable only. */
  quick?: boolean;
}

const arrowOf = (p: Position): Arrow => (p === "above" ? "up" : p === "below" ? "down" : "flat");

export function trends(rmssd: Nightly, rhr?: Nightly, { swc = SWC, early = false } = {}): Map<string, Trend> {
  const r = readings(rmssd, { swc, early });
  const hr = rhr && rhr.size ? banded(rhr, { swc, early, prior: early ? PRIOR.rhr : undefined }) : null;
  const out = new Map<string, Trend>();
  for (const [night, x] of r) {
    const h = arrowOf(x.position);
    const c = arrowOf(x.cvPosition);
    const b = hr?.get(night);
    const rh = b ? arrowOf(b.position) : null;
    // One morning well off is an acute hit, not yet a trend: low HRV or high resting heart rate.
    const response: Response = x.quick
      ? h === "down" || rh === "up" ? "acute" : "stable"
      : h === "down"
        ? c === "up" ? "maladaptation" : "fatigue"
        : c === "up"
          ? "acute"
          : rh !== "up" && (h === "up" || c === "down" || rh === "down")
            ? "coping"
            : "stable";
    out.set(night, { hrv: h, rhr: rh, cv: c, response, quick: x.quick });
  }
  return out;
}
