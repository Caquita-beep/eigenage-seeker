import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Nightly } from "./engine/nights";
import { backfill } from "./engine/whoop/client";
import { toNightly } from "./engine/whoop/nightly";
import { syntheticFetcher, syntheticMember } from "./engine/whoop/synthetic";

/**
 * The body, one value per night, from wherever it lives.
 *
 * Every series is keyed the Exposure way (`engine/nights.ts`): by the evening
 * that starts the night. So the HRV measured while asleep in the small hours
 * of the 11th, and the resting heart rate for the 11th, belong to the night of
 * the 10th — the night that followed the 10th's market and the 10th's trading.
 *
 *   hrv     overnight HRV, ms: the mean of readings taken 00:00–10:00 local
 *   rhr     resting heart rate, bpm, filed under the night before its day
 *   sleep   hours asleep, the union of asleep stages, so two sources
 *           recording the same sleep are not counted twice
 *   energy  active energy, kcal, for the day that ends in that night: the
 *           physical load of the day, which Exposure holds fixed so that a
 *           hard workout is not read as market stress
 *
 * ── Apple Watch measures SDNN, not rMSSD ─────────────────────────────────
 * The method is written for rMSSD. Apple's HRV is SDNN over roughly a
 * minute, taken a few times a night. The method's machinery (log, 7-night
 * baseline, 60-night band, CV) works the same on it, and the state it gives is
 * about this person against themselves, so it is used — but labelled, and its
 * numbers are not comparable with anyone's rMSSD.
 *
 * Every Apple HRV reading also carries the beats it was taken from. A
 * Breathe session in the watch's Mindfulness app takes one, so a
 * one-minute session on waking is a morning reading like a strap's, and its
 * rMSSD is computed here from those beats (`rr.ts`). Once the export holds
 * APPLE_MORNINGS of them, they are the HRV; until then the overnight SDNN is.
 */

export type Point = [night: string, value: number];

export interface BodyNights {
  /**
   * `whoop-synthetic` is a generated member, not anyone's body
   * (`engine/whoop/synthetic.ts`). Every screen that shows it says so.
   */
  source: "apple-health" | "health-connect" | "whoop-synthetic" | "strap";
  metric: "sdnn" | "rmssd";
  /**
   * When the HRV was taken: during sleep unless this says "morning", a
   * one-minute reading on waking — a chest strap's (`readings.ts`) or an Apple
   * Watch Mindfulness session's.
   */
  timing?: "morning";
  /** Apple Health only: the morning Mindfulness sessions found with their heartbeats. */
  mornings?: number;
  hrv: Point[];
  rhr: Point[];
  sleep: Point[];
  energy: Point[];
  /** WHOOP day strain, 0–21, for the day that ends in that night. WHOOP has no active-energy figure; this takes its place as the load held fixed. */
  strain?: Point[];
  importedAt: string;
}

const KEY = "body:nights:v1";

export async function cachedBody(): Promise<BodyNights | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BodyNights) : null;
  } catch {
    return null;
  }
}

export async function saveBody(b: BodyNights) {
  await AsyncStorage.setItem(KEY, JSON.stringify(b));
}

export async function clearBody() {
  await AsyncStorage.removeItem(KEY);
}

export type Progress = (stage: string, fraction?: number) => void;

/**
 * Apple Health mornings once read as rMSSD; kept for wording on old data. Health Connect and Apple Health
 * imports are gone: the body comes from a chest strap only, read by the phone.
 */
export const APPLE_MORNINGS = 14;

/* ── WHOOP, synthetic ───────────────────────────────────────────────────── */

const points = (m: Nightly): Point[] => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/**
 * A generated WHOOP member, for seeing the app work before anyone has a WHOOP.
 *
 * Read through the same path a real account will be: WHOOP's v2 records,
 * paged the way WHOOP pages them, mapped to nights by the same code. Only the
 * fetcher is generated. Nothing about it is a measurement, and the screens
 * label it so wherever it appears.
 */
/**
 * Nights of synthetic history: 32 weeks, so the weekly questions, which need
 * 26 weeks and four before them to set a normal, can all be asked on any day
 * of the week. At 31 (217 nights) the load question stopped at 25 of 26 from
 * Monday to Thursday: the partial weeks at either end are not counted. The
 * synthetic trader uses the same span and the same member (`wallet.ts`).
 */
export const SYNTHETIC_DAYS = 224;

/**
 * The link planted in the synthetic body so the questions have something to
 * find: market fear (DVOL by date) makes the nights swing more. The synthetic
 * trader is built from this same planted body. See `engine/whoop/synthetic.ts`.
 */
export interface SyntheticLinks {
  fear?: Map<string, number>;
}

export async function loadSyntheticWhoop(progress: Progress, links: SyntheticLinks = {}): Promise<BodyNights> {
  progress("Generating a synthetic WHOOP member");
  await new Promise((r) => setTimeout(r, 0));
  // In this phone's own time zone, so "last night" is the reader's last night.
  const off = -new Date().getTimezoneOffset();
  const hhmm = `${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const member = syntheticMember({ timezoneOffset: `${off < 0 ? "-" : "+"}${hhmm}`, days: SYNTHETIC_DAYS, ...links });
  const end = new Date().toISOString();
  const start = new Date(Date.now() - (SYNTHETIC_DAYS + 10) * 86_400_000).toISOString();
  progress("Reading it page by page, as from WHOOP", 0.5);
  const b = toNightly(await backfill(syntheticFetcher(member), { start, end }));
  const out: BodyNights = {
    source: "whoop-synthetic",
    metric: "rmssd",
    hrv: points(b.rmssd),
    rhr: points(b.rhr),
    sleep: points(b.sleep),
    energy: [],
    strain: points(b.strain),
    importedAt: new Date().toISOString(),
  };
  return out;
}
