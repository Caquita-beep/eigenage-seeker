/**
 * HRV from heartbeats: the intervals between beats, cleaned, to rMSSD.
 *
 * Two sources feed it, read the same way:
 *
 *   chest strap   a Polar H10 or any Bluetooth heart-rate strap sends each
 *                 beat's interval as it happens (`strap.ts`), to 1/1024 s
 *   Apple Watch   a Mindfulness session's beats are in the Health export as
 *                 times of day, to 1/100 s (`body.ts`); the intervals are
 *                 their differences
 *
 * rMSSD is the root mean square of the differences between successive
 * intervals: the beat-to-beat change the vagus nerve drives. It is the HRV the
 * method is written for (`engine/hrv.ts`), not the SDNN an Apple Watch reports.
 *
 * ── Cleaning ──────────────────────────────────────────────────────────────
 * An interval is skipped when it is outside 300–2000 ms (200 to 30 bpm), or
 * more than 20% from the median of the five intervals either side of it. That
 * catches a missed beat (the interval doubles), an extra or ectopic one (a
 * short interval, often followed by a long one), and a gap in the recording.
 * rMSSD then uses only differences between two kept intervals that follow each
 * other, so a skipped beat drops its two differences instead of being bridged
 * by a guessed value.
 */

/** One interval between beats, ms; `gap` when the recording lost beats just before it. */
export interface Beat {
  rr: number;
  gap?: boolean;
}

export interface Analysis {
  /** Intervals recorded. */
  beats: number;
  /** Intervals skipped by the cleaning. */
  skipped: number;
  /** Successive differences rMSSD was computed from. */
  pairs: number;
  /** ms; null under MIN_PAIRS_LIVE differences. */
  rmssd: number | null;
  /** bpm, from the kept intervals. */
  hr: number | null;
  /** Per interval, true when skipped. */
  flags: boolean[];
}

export const MIN_RR = 300;
export const MAX_RR = 2000;
/** Intervals either side that make the local median. */
const SIDE = 5;
const TOLERANCE = 0.2;
/** Fewest differences for a figure on screen while recording. */
export const MIN_PAIRS_LIVE = 10;
/** A morning reading counts with at least this many differences and at most this share skipped. */
export const MIN_PAIRS = 30;
export const MAX_SKIPPED = 0.15;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * `quantum`: the resolution, in ms, of the times the intervals were taken
 * from, when they are differences of rounded times (the Apple export's 10 ms).
 * Rounding each time adds independent error to every successive difference,
 * on average q²/2 to its square; that much is taken back out. A strap's
 * intervals are measured directly, to about 1 ms, and need none.
 */
export function analyse(beats: Beat[], { quantum = 0 }: { quantum?: number } = {}): Analysis {
  const n = beats.length;
  const flags = beats.map((b) => !(b.rr >= MIN_RR && b.rr <= MAX_RR));
  const inRange = flags.map((f) => !f);
  for (let i = 0; i < n; i++) {
    if (flags[i]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - SIDE); j <= Math.min(n - 1, i + SIDE); j++) if (j !== i && inRange[j]) near.push(beats[j].rr);
    if (near.length < 2) continue;
    const m = median(near);
    if (Math.abs(beats[i].rr - m) > TOLERANCE * m) flags[i] = true;
  }

  let sum = 0;
  let kept = 0;
  let sq = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    if (flags[i]) continue;
    sum += beats[i].rr;
    kept++;
    if (i > 0 && !flags[i - 1] && !beats[i].gap) {
      const d = beats[i].rr - beats[i - 1].rr;
      sq += d * d;
      pairs++;
    }
  }
  const mssd = pairs ? Math.max(sq / pairs - (quantum * quantum) / 2, 0) : 0;
  return {
    beats: n,
    skipped: n - kept,
    pairs,
    rmssd: pairs >= MIN_PAIRS_LIVE ? Math.sqrt(mssd) : null,
    hr: kept ? 60_000 / (sum / kept) : null,
    flags,
  };
}

/** Whether a finished reading is clean and long enough to keep. */
export function usable(a: Analysis): boolean {
  return a.rmssd !== null && a.pairs >= MIN_PAIRS && a.skipped <= MAX_SKIPPED * a.beats;
}

/** The trailing intervals that add up to at most `ms`: the last half minute, for the live figure. */
export function recent(beats: Beat[], ms: number): Beat[] {
  let t = 0;
  let i = beats.length;
  while (i > 0 && t + beats[i - 1].rr <= ms) t += beats[--i].rr;
  return beats.slice(i);
}

/**
 * A Heart Rate Measurement (Bluetooth characteristic 0x2A37) as the strap
 * sends it: a flags byte, the heart rate (8 or 16 bits), energy expended if
 * flagged, then any intervals since the last one, each 16 bits in 1/1024 s.
 * `contact` is null when the strap does not report skin contact.
 */
export function parseMeasurement(b: ArrayLike<number>): { hr: number; contact: boolean | null; rr: number[] } | null {
  if (b.length < 2) return null;
  const flags = b[0];
  let i: number;
  let hr: number;
  if (flags & 0x01) {
    if (b.length < 3) return null;
    hr = b[1] | (b[2] << 8);
    i = 3;
  } else {
    hr = b[1];
    i = 2;
  }
  const contact = flags & 0x04 ? (flags & 0x02) !== 0 : null;
  if (flags & 0x08) i += 2;
  const rr: number[] = [];
  if (flags & 0x10) for (; i + 1 < b.length; i += 2) rr.push(((b[i] | (b[i + 1] << 8)) * 1000) / 1024);
  return { hr, contact, rr };
}
