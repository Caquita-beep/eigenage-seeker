import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BodyNights, Point } from "./body";
import { addDays } from "./engine/nights";

/**
 * Strap readings: one minute of heartbeats from a chest strap, read to rMSSD
 * on the phone (`rr.ts`). The minute exists nowhere else, so every reading is
 * kept here, whenever it was taken.
 *
 * Only a morning's reading, taken on waking before MORNING_UNTIL_HOUR, is the
 * body's HRV when the strap is its source: HRV moves through the day with
 * posture, food, coffee and stress, so readings are compared like for like,
 * morning with morning. One taken later is kept apart, as an "other" reading,
 * shown on its own and never mixed into the trend.
 *
 * A morning reading belongs to the night before its morning, the Exposure way
 * (`engine/nights.ts`): Thursday's 7:00 reading is the night of Wednesday,
 * the night that followed Wednesday's market and trading.
 */

export interface Reading {
  /** When the minute began, ms since 1970. */
  at: number;
  /** The night a morning reading closes, `YYYY-MM-DD`, the evening's date; null for a reading at another time. */
  night: string | null;
  /** ms. */
  rmssd: number;
  /** bpm, the minute's mean. */
  hr: number;
  beats: number;
  skipped: number;
  /** The strap's name, as it advertises itself. */
  device: string;
  /** The intervals as recorded, ms to 0.1, so a reading can be read again if the cleaning changes. */
  rr: number[];
  /** Its length, minutes; absent for one. */
  minutes?: number;
  /** The breathing pattern followed (`breath.ts`); absent for breathing as it came. */
  breath?: string;
}

/** A reading of the morning, the kind the trend is built from. */
export const isMorning = (r: Reading) => r.night !== null;

const KEY = "morning:readings:v1";

/** Readings taken before this hour, local, are the morning's. */
export const MORNING_UNTIL_HOUR = 14;

/** The night a reading taken at `ms` closes, or null after the morning is over. */
export function morningNight(ms: number): string | null {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  if (d.getUTCHours() >= MORNING_UNTIL_HOUR) return null;
  return addDays(d.toISOString().slice(0, 10), -1);
}

// v1 kept only morning readings, under the same key; each already has its night, so they read unchanged.
/**
 * This morning's reading, for Today: due (it is morning and none is taken), done (with it), or missed (the
 * morning is over without one).
 */
export function thisMorning(readings: Reading[], now = Date.now()): { kind: "due" } | { kind: "done"; r: Reading } | { kind: "missed" } {
  const night = morningNight(now);
  const today = new Date(now).toDateString();
  const r = readings.findLast((x) => x.night !== null && (night ? x.night === night : new Date(x.at).toDateString() === today));
  return r ? { kind: "done", r } : night ? { kind: "due" } : { kind: "missed" };
}

export async function loadReadings(): Promise<Reading[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Reading[]) : [];
    return Array.isArray(list) ? list.map((r) => ({ ...r, night: r.night ?? null })) : [];
  } catch {
    return [];
  }
}

/**
 * Saves `r`. A morning reading replaces any earlier one of the same morning: measuring again means the first
 * one went wrong. Readings at other times are all kept.
 */
export async function addReading(r: Reading): Promise<Reading[]> {
  const list = (await loadReadings()).filter((x) => r.night === null || x.night !== r.night);
  list.push(r);
  list.sort((a, b) => a.at - b.at);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

/** Deletes the reading that began at `at`: a minute that went wrong, or one that was not the reader's. */
export async function removeReading(at: number): Promise<Reading[]> {
  const list = (await loadReadings()).filter((x) => x.at !== at);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export async function clearReadings() {
  await AsyncStorage.removeItem(KEY);
}

/**
 * The body the morning readings make: HRV and the morning's heart rate per night; no sleep or activity, which a
 * strap does not record. Null without a morning reading: readings at other times are never the body's HRV.
 */
export function readingsBody(list: Reading[]): BodyNights | null {
  const by = list.filter(isMorning).sort((a, b) => (a.night! < b.night! ? -1 : a.night! > b.night! ? 1 : a.at - b.at));
  if (!by.length) return null;
  return {
    source: "strap",
    metric: "rmssd",
    timing: "morning",
    hrv: by.map((r): Point => [r.night!, r.rmssd]),
    rhr: by.map((r): Point => [r.night!, r.hr]),
    sleep: [],
    energy: [],
    importedAt: new Date().toISOString(),
  };
}
