/**
 * Breathing patterns for the guide (`breather.tsx`): each a cycle of phases,
 * each phase a length and how full the lungs are at its end, 0 empty to 1
 * full. A hold keeps the level it starts at.
 *
 * Paced breathing raises HRV while it lasts, the slower the more: at about
 * five and a half breaths a minute heart rate swings most with the breath.
 * So a reading is taken breathing normally (`app/reading.tsx`), and the
 * patterns are an exercise of their own (`app/breathe.tsx`), with HRV live
 * from the strap when it is on, and when to do it from the assessment
 * (`breathadvice.ts`).
 */

export type PhaseLabel = "In" | "Hold" | "Out" | "In again";

export interface Phase {
  label: PhaseLabel;
  /** Seconds. */
  s: number;
  /** Fullness at the end, 0–1. */
  to: number;
}

export interface Pattern {
  id: string;
  name: string;
  /** What it is, in a line. */
  line: string;
  phases: Phase[];
}

/** No guide: breathing as it comes. */
export const NORMAL = "normal";

export const PATTERNS: Pattern[] = [
  {
    id: "resonance",
    name: "Resonance",
    line: "5.5 seconds in, 5.5 out. The best studied: near the pace at which heart rate swings most with the breath.",
    phases: [
      { label: "In", s: 5.5, to: 1 },
      { label: "Out", s: 5.5, to: 0 },
    ],
  },
  {
    id: "long-exhale",
    name: "Long exhale",
    line: "4 seconds in, 6 out. Six a minute, the slow pace doing most of the work; the longer out-breath can feel calmer.",
    phases: [
      { label: "In", s: 4, to: 1 },
      { label: "Out", s: 6, to: 0 },
    ],
  },
  {
    id: "box",
    name: "Box",
    line: "4 in, hold 4, 4 out, hold 4. Even and steady, slower than six a minute with the holds.",
    phases: [
      { label: "In", s: 4, to: 1 },
      { label: "Hold", s: 4, to: 1 },
      { label: "Out", s: 4, to: 0 },
      { label: "Hold", s: 4, to: 0 },
    ],
  },
  {
    id: "478",
    name: "4-7-8",
    line: "4 in, hold 7, 8 out. Very slow, for winding down, if the long hold is comfortable.",
    phases: [
      { label: "In", s: 4, to: 1 },
      { label: "Hold", s: 7, to: 1 },
      { label: "Out", s: 8, to: 0 },
    ],
  },
  {
    id: "sigh",
    name: "Sigh",
    line: "In, a second short breath in on top, then a long, slow out. Five minutes a day lifted mood in a month-long trial.",
    phases: [
      { label: "In", s: 2, to: 0.7 },
      { label: "In again", s: 1, to: 1 },
      { label: "Out", s: 6, to: 0 },
    ],
  },
];

export const patternOf = (id: string | null | undefined): Pattern | null => PATTERNS.find((p) => p.id === id) ?? null;

/** One cycle, ms. */
export const cycleMs = (p: Pattern) => p.phases.reduce((t, x) => t + x.s * 1000, 0);

/** Breaths a minute, to one decimal. */
export const perMinute = (p: Pattern) => Math.round((600_000 / cycleMs(p))) / 10;

/** "4 in · 7 hold · 8 out": the pattern in seconds. */
export const rhythm = (p: Pattern) => p.phases.map((x) => `${x.s} ${x.label === "Hold" ? "hold" : x.label === "Out" ? "out" : "in"}`).join(" · ");

/**
 * One cycle's breath as an SVG path in `w` by `h`: rising in, flat on a hold, falling out, eased as the guide
 * eases it. For the pattern's mark in a list.
 */
export function shapePath(p: Pattern, w: number, h: number, pad = 1.5): string {
  const total = cycleMs(p) / 1000;
  const steps = 12;
  let prev = p.phases[p.phases.length - 1].to;
  let t0 = 0;
  let d = "";
  for (const x of p.phases) {
    for (let k = 0; k <= steps; k++) {
      const q = k / steps;
      const v = prev + (x.to - prev) * (0.5 - 0.5 * Math.cos(Math.PI * q));
      d += `${d ? "L" : "M"}${(((t0 + q * x.s) / total) * w).toFixed(1)},${(h - pad - v * (h - 2 * pad)).toFixed(1)}`;
    }
    prev = x.to;
    t0 += x.s;
  }
  return d;
}

/** Where `ms` into the pattern falls: the phase, the seconds left in it, and how far through the cycle. */
export function phaseAt(p: Pattern, ms: number): { i: number; phase: Phase; left: number; u: number } {
  const total = cycleMs(p);
  let r = ((ms % total) + total) % total;
  const u = r / total;
  for (let i = 0; i < p.phases.length; i++) {
    const d = p.phases[i].s * 1000;
    if (r < d) return { i, phase: p.phases[i], left: (d - r) / 1000, u };
    r -= d;
  }
  const last = p.phases.length - 1;
  return { i: last, phase: p.phases[last], left: 0, u };
}
