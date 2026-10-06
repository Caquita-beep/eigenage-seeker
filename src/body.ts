import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDocumentAsync } from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import {
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import { listContents, unzip } from "react-native-zip-archive";
import { addDays, type Nightly } from "./engine/nights";
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
 * Altini's method is written for rMSSD. Apple's HRV is SDNN over roughly a
 * minute, taken a few times a night. The method's machinery (log, 7-night
 * baseline, 60-night band, CV) works the same on it, and the state it gives is
 * about this person against themselves, so it is used — but labelled, and its
 * numbers are not comparable with anyone's rMSSD.
 */

export type Point = [night: string, value: number];

export interface BodyNights {
  /**
   * `whoop-synthetic` is a generated member, not anyone's body
   * (`engine/whoop/synthetic.ts`). Every screen that shows it says so.
   */
  source: "apple-health" | "health-connect" | "whoop-synthetic";
  metric: "sdnn" | "rmssd";
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

/* ── Keying ─────────────────────────────────────────────────────────────── */

/** Overnight readings only: 00:00 to 10:00 local, filed under the evening before. */
const HRV_UNTIL_HOUR = 10;

function hrvNight(localDate: string, hour: number): string | null {
  return hour < HRV_UNTIL_HOUR ? addDays(localDate, -1) : null;
}

/** A sleep segment belongs to the night of the evening before it ended, unless it ended after 16:00 (an evening nap). */
function sleepNight(localDate: string, hour: number): string {
  return hour < 16 ? addDays(localDate, -1) : localDate;
}

class Acc {
  private m = new Map<string, { s: number; n: number }>();
  add(k: string, v: number) {
    const e = this.m.get(k);
    if (e) (e.s += v), e.n++;
    else this.m.set(k, { s: v, n: 1 });
  }
  means(): Point[] {
    return [...this.m.entries()].map(([k, e]) => [k, e.s / e.n] as Point).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
}

/** Per day, per source sums; the day's value is the largest source, so a watch and a phone logging the same walk are not added. */
class SourceSums {
  private m = new Map<string, Map<string, number>>();
  add(day: string, source: string, v: number) {
    let d = this.m.get(day);
    if (!d) this.m.set(day, (d = new Map()));
    d.set(source, (d.get(source) ?? 0) + v);
  }
  points(): Point[] {
    return [...this.m.entries()].map(([k, d]) => [k, Math.max(...d.values())] as Point).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
}

/** Hours asleep per night from possibly overlapping segments. */
function sleepHours(segments: { night: string; a: number; b: number }[]): Point[] {
  const by = new Map<string, [number, number][]>();
  for (const s of segments) {
    if (s.b <= s.a) continue;
    const list = by.get(s.night) ?? [];
    list.push([s.a, s.b]);
    by.set(s.night, list);
  }
  const out: Point[] = [];
  for (const [night, list] of by) {
    list.sort((x, y) => x[0] - y[0]);
    let total = 0;
    let [ca, cb] = list[0];
    for (const [a, b] of list.slice(1)) {
      if (a <= cb) cb = Math.max(cb, b);
      else {
        total += cb - ca;
        [ca, cb] = [a, b];
      }
    }
    total += cb - ca;
    out.push([night, total / 3_600_000]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/* ── Apple Health export ────────────────────────────────────────────────── */

/**
 * `export.zip` from the iPhone's Health app (profile → Export All Health
 * Data), sent to this phone. Only `export.xml` is extracted, and it is read in
 * chunks and scanned for four record types, so a multi-gigabyte export never
 * has to fit in memory. Every other record — heart rate every few minutes,
 * steps, workouts — is skipped without being parsed.
 */
export async function importAppleHealth(progress: Progress): Promise<BodyNights | null> {
  const pick = await getDocumentAsync({ type: ["application/zip", "application/octet-stream", "*/*"], copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets?.[0]) return null;
  const zipUri = pick.assets[0].uri;

  progress("Finding export.xml in the archive");
  const entries = await listContents(zipUri.replace("file://", ""));
  const entry = entries.find((e) => /(^|\/)export\.xml$/.test(e.path));
  if (!entry) throw new Error("This zip has no export.xml. Export it from the Health app: profile, then Export All Health Data.");

  const dir = new Directory(Paths.cache, "apple-health");
  if (dir.exists) dir.delete();
  dir.create();
  progress("Extracting export.xml");
  await unzip(zipUri.replace("file://", ""), dir.uri.replace("file://", ""), [entry.path]);
  const xml = new File(dir, entry.path);

  try {
    const b = await scanAppleExport(xml, progress);
    await saveBody(b);
    return b;
  } finally {
    try {
      dir.delete();
      new File(zipUri).delete();
    } catch {}
  }
}

const T_HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN"';
const T_RHR = 'HKQuantityTypeIdentifierRestingHeartRate"';
const T_ENERGY = 'HKQuantityTypeIdentifierActiveEnergyBurned"';
const T_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis"';

function attr(tag: string, name: string): string | null {
  const i = tag.indexOf(` ${name}="`);
  if (i < 0) return null;
  const s = i + name.length + 3;
  return tag.slice(s, tag.indexOf('"', s));
}

/** "2026-09-11 02:41:10 -0500" → local date, local hour, and the instant. */
function appleTime(s: string) {
  const date = s.slice(0, 10);
  const hour = Number(s.slice(11, 13));
  const ms = Date.parse(`${date}T${s.slice(11, 19)}${s.slice(20, 23)}:${s.slice(23, 25)}`);
  return { date, hour, ms };
}

async function scanAppleExport(xml: File, progress: Progress): Promise<BodyNights> {
  const hrv = new Acc();
  const rhr = new Acc();
  const energy = new SourceSums();
  const sleep: { night: string; a: number; b: number }[] = [];

  const handle = xml.open();
  const size = handle.size ?? xml.size ?? 0;
  const CHUNK = 4 * 1024 * 1024;
  const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  let carry = "";
  let read = 0;

  const each = (buf: string, type: string, fn: (tag: string) => void) => {
    let i = buf.indexOf(type);
    while (i >= 0) {
      const start = buf.lastIndexOf("<Record", i);
      const end = buf.indexOf(">", i);
      if (start >= 0 && end > i) fn(buf.slice(start, end));
      i = buf.indexOf(type, i + type.length);
    }
  };

  try {
    for (;;) {
      const bytes = handle.readBytes(CHUNK);
      if (!bytes.length) break;
      read += bytes.length;
      let text: string;
      if (decoder) text = decoder.decode(bytes, { stream: true });
      else {
        const parts: string[] = [];
        for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000))));
        text = parts.join("");
      }
      const buf = carry + text;
      const cut = buf.lastIndexOf("\n");
      const body = cut >= 0 ? buf.slice(0, cut) : "";
      carry = cut >= 0 ? buf.slice(cut) : buf;

      each(body, T_HRV, (tag) => {
        const v = Number(attr(tag, "value"));
        const t = attr(tag, "startDate");
        if (!t || !(v > 0)) return;
        const { date, hour } = appleTime(t);
        const night = hrvNight(date, hour);
        if (night) hrv.add(night, v);
      });
      each(body, T_RHR, (tag) => {
        const v = Number(attr(tag, "value"));
        const t = attr(tag, "startDate");
        if (!t || !(v > 0)) return;
        rhr.add(addDays(appleTime(t).date, -1), v);
      });
      each(body, T_ENERGY, (tag) => {
        let v = Number(attr(tag, "value"));
        const t = attr(tag, "startDate");
        if (!t || !(v > 0)) return;
        if (attr(tag, "unit") === "kJ") v /= 4.184;
        energy.add(appleTime(t).date, attr(tag, "sourceName") ?? "", v);
      });
      each(body, T_SLEEP, (tag) => {
        const value = attr(tag, "value") ?? "";
        if (!value.includes("Asleep")) return;
        const s = attr(tag, "startDate");
        const e = attr(tag, "endDate");
        if (!s || !e) return;
        const end = appleTime(e);
        sleep.push({ night: sleepNight(end.date, end.hour), a: appleTime(s).ms, b: end.ms });
      });

      progress("Reading your Apple Health export", size ? read / size : undefined);
      // Let the progress bar paint between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    handle.close();
  }

  const out: BodyNights = {
    source: "apple-health",
    metric: "sdnn",
    hrv: hrv.means(),
    rhr: rhr.means(),
    sleep: sleepHours(sleep),
    energy: energy.points(),
    importedAt: new Date().toISOString(),
  };
  if (!out.hrv.length) throw new Error("No overnight HRV in this export. HRV comes from an Apple Watch worn to bed.");
  return out;
}

/* ── Health Connect ─────────────────────────────────────────────────────── */

const HC_DAYS = 400;

/** Local date and hour of an instant, in this phone's time zone at that instant. */
function local(iso: string) {
  const ms = Date.parse(iso);
  const off = -new Date(ms).getTimezoneOffset();
  const d = new Date(ms + off * 60_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), ms };
}

async function readAll<T>(type: Parameters<typeof readRecords>[0], startTime: string, endTime: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const r = await readRecords(type, { timeRangeFilter: { operator: "between", startTime, endTime }, pageSize: 5000, pageToken });
    out.push(...(r.records as unknown as T[]));
    pageToken = r.pageToken || undefined;
  } while (pageToken);
  return out;
}

export async function readHealthConnect(progress: Progress): Promise<BodyNights> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) throw new Error("Health Connect is not available on this phone.");
  await initialize();
  progress("Asking for permission");
  const granted = await requestPermission([
    { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
    { accessType: "read", recordType: "RestingHeartRate" },
    { accessType: "read", recordType: "SleepSession" },
    { accessType: "read", recordType: "ActiveCaloriesBurned" },
    // Without this, Health Connect serves only the 30 days before the first grant.
    { accessType: "read", recordType: "ReadHealthDataHistory" },
  ]);
  if (!granted.some((p) => p.recordType === "HeartRateVariabilityRmssd")) {
    throw new Error("EigenAge needs permission to read heart rate variability.");
  }

  const end = new Date().toISOString();
  const start = new Date(Date.now() - HC_DAYS * 86_400_000).toISOString();

  progress("Reading HRV", 0.1);
  const hrvRecs = await readAll<{ time: string; heartRateVariabilityMillis: number }>("HeartRateVariabilityRmssd", start, end);
  const hrv = new Acc();
  for (const r of hrvRecs) {
    const { date, hour } = local(r.time);
    const night = hrvNight(date, hour);
    if (night && r.heartRateVariabilityMillis > 0) hrv.add(night, r.heartRateVariabilityMillis);
  }

  progress("Reading resting heart rate", 0.35);
  const rhr = new Acc();
  for (const r of await readAll<{ time: string; beatsPerMinute: number }>("RestingHeartRate", start, end)) {
    if (r.beatsPerMinute > 0) rhr.add(addDays(local(r.time).date, -1), r.beatsPerMinute);
  }

  progress("Reading sleep", 0.6);
  const segments: { night: string; a: number; b: number }[] = [];
  const ASLEEP = new Set([2, 4, 5, 6]);
  for (const r of await readAll<{ startTime: string; endTime: string; stages?: { startTime: string; endTime: string; stage: number }[] }>("SleepSession", start, end)) {
    const e = local(r.endTime);
    const night = sleepNight(e.date, e.hour);
    const stages = r.stages?.filter((s) => ASLEEP.has(s.stage)) ?? [];
    if (stages.length) for (const s of stages) segments.push({ night, a: Date.parse(s.startTime), b: Date.parse(s.endTime) });
    else segments.push({ night, a: Date.parse(r.startTime), b: e.ms });
  }

  progress("Reading activity", 0.85);
  const energy = new SourceSums();
  for (const r of await readAll<{ startTime: string; energy: { inKilocalories: number }; metadata?: { dataOrigin?: string } }>("ActiveCaloriesBurned", start, end)) {
    energy.add(local(r.startTime).date, r.metadata?.dataOrigin ?? "", r.energy.inKilocalories);
  }

  const out: BodyNights = {
    source: "health-connect",
    metric: "rmssd",
    hrv: hrv.means(),
    rhr: rhr.means(),
    sleep: sleepHours(segments),
    energy: energy.points(),
    importedAt: new Date().toISOString(),
  };
  if (!out.hrv.length) {
    throw new Error("Health Connect has no HRV yet. Install your wearable's app on this phone and let it sync to Health Connect.");
  }
  await saveBody(out);
  return out;
}

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
 * Nights of synthetic history: 31 weeks, so the weekly questions, which need
 * 26 weeks and four before them to set a normal, can all be asked. The
 * synthetic trader uses the same span and the same member (`wallet.ts`).
 */
export const SYNTHETIC_DAYS = 217;

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
  await saveBody(out);
  return out;
}
