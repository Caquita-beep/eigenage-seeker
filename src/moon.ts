import { addDays, type Nightly } from "./engine/nights";

/**
 * The moon, from the date alone: no source to fetch. Two things.
 *
 *   Phases       the times of new moon, first quarter, full moon and last
 *                quarter, by Meeus (Astronomical Algorithms, ch. 49) with
 *                the leading periodic terms: within an hour or so, enough
 *                to put each on the right day of the calendar.
 *   Moonlight    the share of the disc lit, from the moon's age on the mean
 *                lunation: (1 − cos(2π · age / 29.53)) / 2. Off by hours at
 *                most, which a nightly value does not feel.
 *
 * Whether the moon touches sleep or markets is contested: a few studies find
 * slightly later, shorter sleep around full moon, others do not replicate it,
 * and lunar effects on returns are small and fragile. It is here so the
 * reader's own data can say, under the same guard against chance as every
 * other factor (`drivers.ts`).
 */

export type Phase = "new" | "first" | "full" | "last";
export const PHASE_GLYPH: Record<Phase, string> = { new: "🌑", first: "🌓", full: "🌕", last: "🌗" };
export const PHASE_WORD: Record<Phase, string> = { new: "New moon", first: "First quarter", full: "Full moon", last: "Last quarter" };

const SYNODIC = 29.530588853;
const DAY = 86_400_000;
/** A new moon: 6 January 2000, 18:14 UTC. */
const NEW_REF = Date.UTC(2000, 0, 6, 18, 14);
const rad = (deg: number) => (deg * Math.PI) / 180;
const jdToMs = (jd: number) => (jd - 2440587.5) * DAY;

/** The share of the moon's disc lit at `ms`, 0 to 1. */
export function moonlight(ms: number): number {
  const age = ((((ms - NEW_REF) / DAY) % SYNODIC) + SYNODIC) % SYNODIC;
  return (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
}

/** The time of one principal phase: lunation `k` (0 = January 2000) plus 0, ¼, ½ or ¾. */
function phaseTime(k: number): number {
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T;
  const M = rad(2.5534 + 29.1053567 * k);
  const Mp = rad(201.5643 + 385.81693528 * k);
  const F = rad(160.7108 + 390.67050284 * k);
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T;
  const q = Math.round((k - Math.floor(k)) * 4) % 4;
  if (q === 0 || q === 2) {
    const full = q === 2;
    jde +=
      (full ? -0.40614 : -0.4072) * Math.sin(Mp) +
      (full ? 0.17302 : 0.17241) * E * Math.sin(M) +
      (full ? 0.01614 : 0.01608) * Math.sin(2 * Mp) +
      (full ? 0.01043 : 0.01039) * Math.sin(2 * F) +
      (full ? 0.00734 : 0.00739) * E * Math.sin(Mp - M) -
      (full ? 0.00515 : 0.00514) * E * Math.sin(Mp + M);
  } else {
    jde +=
      -0.62801 * Math.sin(Mp) +
      0.17172 * E * Math.sin(M) -
      0.01183 * E * Math.sin(Mp + M) +
      0.00862 * Math.sin(2 * Mp) +
      0.00804 * Math.sin(2 * F) +
      0.00454 * E * Math.sin(Mp - M);
    const W = 0.00306 - 0.00038 * E * Math.cos(M) + 0.00026 * Math.cos(Mp);
    jde += q === 1 ? W : -W;
  }
  return jdToMs(jde);
}

/** Every principal phase between two times. */
export function phasesBetween(from: number, to: number): { phase: Phase; ms: number }[] {
  const names: Phase[] = ["new", "first", "full", "last"];
  const k0 = Math.floor((from - NEW_REF) / DAY / SYNODIC) - 1;
  const out: { phase: Phase; ms: number }[] = [];
  for (let k = k0; ; k++) {
    for (let q = 0; q < 4; q++) {
      const ms = phaseTime(k + q / 4);
      if (ms >= from && ms < to) out.push({ phase: names[q], ms });
    }
    if (phaseTime(k) > to) break;
  }
  return out;
}

/** Each local calendar day in [first, last] that holds a principal phase. */
export function phaseDays(first: string, last: string, offsetMinutes: number): Map<string, Phase> {
  const start = Date.parse(`${first}T00:00:00Z`) - offsetMinutes * 60_000;
  const end = Date.parse(`${addDays(last, 1)}T00:00:00Z`) - offsetMinutes * 60_000;
  const out = new Map<string, Phase>();
  for (const { phase, ms } of phasesBetween(start, end)) out.set(new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10), phase);
  return out;
}

/** Moonlight each night: the disc lit at the local midnight that night spans (night D: the midnight starting D + 1). */
export function moonNights(nights: Iterable<string>, offsetMinutes: number): Nightly {
  const out: Nightly = new Map();
  for (const night of nights) out.set(night, moonlight(Date.parse(`${addDays(night, 1)}T00:00:00Z`) - offsetMinutes * 60_000));
  return out;
}
