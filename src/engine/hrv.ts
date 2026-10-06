import { addDays, type Nightly } from "./nights";

/**
 * The body read the way Plews and Altini read an athlete: not by the night's
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
  cv: number;
  position: Position;
  cvPosition: Position;
  state: State;
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
  { short = SHORT, long = LONG, swc = SWC } = {},
): Map<string, { baseline: number; low: number; high: number; position: Position }> {
  const out = new Map<string, { baseline: number; low: number; high: number; position: Position }>();
  for (const night of [...series.keys()].sort()) {
    const s = window(series, night, short);
    const l = window(series, night, long);
    // Most of each window present, or the reading is a guess.
    if (s.length < Math.ceil(short * 0.7) || l.length < Math.ceil(long * 0.5)) continue;
    const baseline = mean(s);
    const m = mean(l);
    const half = swc * sd(l);
    const position: Position = baseline < m - half ? "below" : baseline > m + half ? "above" : "within";
    out.set(night, { baseline, low: m - half, high: m + half, position });
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

export function readings(rmssd: Nightly, { swc = SWC } = {}): Map<string, Reading> {
  const ln = lnRmssd(rmssd);
  const cv = cv7(ln);
  const base = banded(ln, { swc });
  const cvBand = banded(cv, { short: 1, swc });
  const out = new Map<string, Reading>();
  for (const [night, b] of base) {
    const c = cvBand.get(night);
    if (!c) continue;
    const cvPosition = c.position;
    const state: State =
      b.position === "below"
        ? cvPosition === "above" ? "strained" : "suppressed"
        : cvPosition === "above"
          ? "perturbed"
          : b.position === "above" ? "elevated" : "coping";
    out.set(night, { baseline: b.baseline, low: b.low, high: b.high, cv: cv.get(night)!, position: b.position, cvPosition, state });
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
}

const arrowOf = (p: Position): Arrow => (p === "above" ? "up" : p === "below" ? "down" : "flat");

export function trends(rmssd: Nightly, rhr?: Nightly, { swc = SWC } = {}): Map<string, Trend> {
  const r = readings(rmssd, { swc });
  const hr = rhr && rhr.size ? banded(rhr, { swc }) : null;
  const out = new Map<string, Trend>();
  for (const [night, x] of r) {
    const h = arrowOf(x.position);
    const c = arrowOf(x.cvPosition);
    const b = hr?.get(night);
    const rh = b ? arrowOf(b.position) : null;
    const response: Response =
      h === "down"
        ? c === "up" ? "maladaptation" : "fatigue"
        : c === "up"
          ? "acute"
          : rh !== "up" && (h === "up" || c === "down" || rh === "down")
            ? "coping"
            : "stable";
    out.set(night, { hrv: h, rhr: rh, cv: c, response });
  }
  return out;
}
