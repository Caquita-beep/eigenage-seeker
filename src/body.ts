import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDocumentAsync } from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import { listContents, unzip } from "react-native-zip-archive";
import { addDays, type Nightly } from "./engine/nights";
import { MORNING_UNTIL_HOUR } from "./readings";
import { analyse, usable, type Beat } from "./rr";
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
    return await scanAppleExport(xml, progress);
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
const T_MINDFUL = 'HKCategoryTypeIdentifierMindfulSession"';

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

/** Morning readings from Mindfulness sessions replace the overnight SDNN once there are this many. */
export const APPLE_MORNINGS = 14;
/** A Mindfulness session is a morning reading when it starts from 03:00 to before this hour, local. */
const SESSION_FROM_HOUR = 3;

/**
 * A heartbeat's time of day as the export writes it, in the phone's locale:
 * "7:12:04.53 AM", "07:12:04,53", "19:12:04.53", "上午7:12:04.53". Returned
 * as seconds into a 12-hour clock, so the AM/PM marker, in whatever
 * language, never matters: only differences between beats a second apart are
 * used. `digits`: the decimals given, which set the time's resolution.
 */
export function beatTime(s: string): { sec: number; digits: number } | null {
  const m = /(\d{1,2})[:.](\d{2})[:.](\d{2})(?:[.,](\d+))?/.exec(s);
  if (!m) return null;
  const frac = m[4] ?? "";
  return { sec: (Number(m[1]) % 12) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (frac ? Number(`0.${frac}`) : 0), digits: frac.length };
}

const HALF_DAY = 43_200;

/**
 * An HRV record's heartbeats to rMSSD. The intervals are the differences of
 * the beats' times, to the export's 1/100 s, with the rounding taken back out
 * (`rr.ts`); where the times cannot be read, the beats' whole-number bpm.
 */
export function beatsReading(children: string) {
  const beats: { bpm: number; time: string }[] = [];
  let i = children.indexOf("<InstantaneousBeatsPerMinute");
  while (i >= 0) {
    const end = children.indexOf(">", i);
    if (end < 0) break;
    const tag = children.slice(i, end);
    const bpm = Number(attr(tag, "bpm"));
    const time = attr(tag, "time");
    if (bpm > 0 && time) beats.push({ bpm, time });
    i = children.indexOf("<InstantaneousBeatsPerMinute", end);
  }
  if (beats.length < 2) return null;
  const times = beats.map((b) => beatTime(b.time));
  const digits = Math.min(...times.map((t) => t?.digits ?? 0));
  let rr: Beat[];
  let quantum = 0;
  if (times.every((t) => t) && digits >= 2) {
    rr = [];
    for (let k = 1; k < times.length; k++) rr.push({ rr: ((((times[k]!.sec - times[k - 1]!.sec) % HALF_DAY) + HALF_DAY) % HALF_DAY) * 1000 });
    quantum = 10 ** (3 - digits);
  } else {
    rr = beats.slice(1).map((b) => ({ rr: 60_000 / b.bpm }));
  }
  const a = analyse(rr, { quantum });
  return usable(a) ? { rmssd: a.rmssd!, hr: a.hr!, pairs: a.pairs } : null;
}

/**
 * `export.xml`, read piece by piece: `push` each decoded piece in order, then
 * `finish`. Apart from the file so that it can be tested on any split.
 *
 * Each piece is read up to its last full line; the rest waits for the next.
 * An HRV record's heartbeats are on lines of their own after it, so a record
 * still open at the cut waits whole.
 */
export class AppleScan {
  private carry = "";
  private hrv = new Acc();
  private rhr = new Acc();
  private energy = new SourceSums();
  private sleep: { night: string; a: number; b: number }[] = [];
  private sessions: { a: number; b: number; date: string; hour: number }[] = [];
  private beatReadings: { a: number; b: number; rmssd: number; hr: number; pairs: number }[] = [];

  push(text: string, { last = false }: { last?: boolean } = {}) {
    const buf = this.carry + text;
    let cut = last ? buf.length : buf.lastIndexOf("\n");
    if (!last && cut >= 0) {
      const open = buf.lastIndexOf("<Record", cut);
      const end = open >= 0 ? buf.indexOf(">", open) : -1;
      if (open >= 0 && (end < 0 || end >= cut || (buf[end - 1] !== "/" && !(buf.indexOf("</Record>", end) >= 0 && buf.indexOf("</Record>", end) < cut)))) {
        cut = Math.max(buf.lastIndexOf("\n", open), 0);
      }
    }
    if (cut < 0) {
      this.carry = buf;
      return;
    }
    this.read(buf.slice(0, cut));
    this.carry = buf.slice(cut);
  }

  private each(buf: string, type: string, fn: (tag: string, end: number) => void) {
    let i = buf.indexOf(type);
    while (i >= 0) {
      const start = buf.lastIndexOf("<Record", i);
      const end = buf.indexOf(">", i);
      if (start >= 0 && end > i) fn(buf.slice(start, end), end);
      i = buf.indexOf(type, i + type.length);
    }
  }

  private read(body: string) {
    this.each(body, T_HRV, (tag, end) => {
      const v = Number(attr(tag, "value"));
      const t = attr(tag, "startDate");
      if (!t || !(v > 0)) return;
      const start = appleTime(t);
      const night = hrvNight(start.date, start.hour);
      if (night) this.hrv.add(night, v);
      if (tag.endsWith("/")) return;
      const close = body.indexOf("</Record>", end);
      const e = attr(tag, "endDate");
      const r = close > end && e ? beatsReading(body.slice(end + 1, close)) : null;
      if (r) this.beatReadings.push({ a: start.ms, b: appleTime(e!).ms, ...r });
    });
    this.each(body, T_MINDFUL, (tag) => {
      const s = attr(tag, "startDate");
      const e = attr(tag, "endDate");
      if (!s || !e) return;
      const start = appleTime(s);
      this.sessions.push({ a: start.ms, b: appleTime(e).ms, date: start.date, hour: start.hour });
    });
    this.each(body, T_RHR, (tag) => {
      const v = Number(attr(tag, "value"));
      const t = attr(tag, "startDate");
      if (!t || !(v > 0)) return;
      this.rhr.add(addDays(appleTime(t).date, -1), v);
    });
    this.each(body, T_ENERGY, (tag) => {
      let v = Number(attr(tag, "value"));
      const t = attr(tag, "startDate");
      if (!t || !(v > 0)) return;
      if (attr(tag, "unit") === "kJ") v /= 4.184;
      this.energy.add(appleTime(t).date, attr(tag, "sourceName") ?? "", v);
    });
    this.each(body, T_SLEEP, (tag) => {
      const value = attr(tag, "value") ?? "";
      if (!value.includes("Asleep")) return;
      const s = attr(tag, "startDate");
      const e = attr(tag, "endDate");
      if (!s || !e) return;
      const end = appleTime(e);
      this.sleep.push({ night: sleepNight(end.date, end.hour), a: appleTime(s).ms, b: end.ms });
    });
  }

  /**
   * Each morning's first Mindfulness session, read from the HRV reading taken
   * during it: the one with the most beats, when the watch took more than one.
   */
  mornings(): Point[] {
    const SLACK = 60_000;
    const out = new Map<string, { at: number; rmssd: number }>();
    for (const s of this.sessions) {
      if (s.hour < SESSION_FROM_HOUR || s.hour >= MORNING_UNTIL_HOUR) continue;
      const during = this.beatReadings.filter((r) => r.a < s.b + SLACK && r.b > s.a - SLACK).sort((x, y) => y.pairs - x.pairs)[0];
      if (!during) continue;
      const night = addDays(s.date, -1);
      const had = out.get(night);
      if (!had || s.a < had.at) out.set(night, { at: s.a, rmssd: during.rmssd });
    }
    return [...out.entries()].map(([k, v]): Point => [k, v.rmssd]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  finish(): BodyNights {
    this.push("", { last: true });
    const mornings = this.mornings();
    const fromMornings = mornings.length >= APPLE_MORNINGS;
    const out: BodyNights = {
      source: "apple-health",
      metric: fromMornings ? "rmssd" : "sdnn",
      ...(fromMornings ? { timing: "morning" as const } : {}),
      mornings: mornings.length,
      hrv: fromMornings ? mornings : this.hrv.means(),
      rhr: this.rhr.means(),
      sleep: sleepHours(this.sleep),
      energy: this.energy.points(),
      importedAt: new Date().toISOString(),
    };
    if (!out.hrv.length) throw new Error("No overnight HRV in this export. HRV comes from an Apple Watch worn to bed, or a Mindfulness session on it each morning.");
    return out;
  }
}

async function scanAppleExport(xml: File, progress: Progress): Promise<BodyNights> {
  const scan = new AppleScan();
  const handle = xml.open();
  const size = handle.size ?? xml.size ?? 0;
  const CHUNK = 4 * 1024 * 1024;
  const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  let read = 0;

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
      scan.push(text);
      progress("Reading your Apple Health export", size ? read / size : undefined);
      // Let the progress bar paint between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    handle.close();
  }
  return scan.finish();
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

/**
 * Every night Health Connect holds, read again in full. `ask: false` reads
 * only with the permission already granted, for the quiet re-read on opening
 * the app; it never shows Health Connect's permission screen.
 */
export async function readHealthConnect(progress: Progress, { ask = true }: { ask?: boolean } = {}): Promise<BodyNights> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) throw new Error("Health Connect is not available on this phone.");
  await initialize();
  progress("Asking for permission");
  // The manifest must declare each of these (`app.json`, android.permissions), or Health Connect grants none of them.
  const granted = ask
    ? await requestPermission([
        { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
        { accessType: "read", recordType: "RestingHeartRate" },
        { accessType: "read", recordType: "SleepSession" },
        { accessType: "read", recordType: "ActiveCaloriesBurned" },
        // Without this, Health Connect serves only the 30 days before the first grant.
        { accessType: "read", recordType: "ReadHealthDataHistory" },
      ])
    : await getGrantedPermissions();
  if (!granted.some((p) => p.recordType === "HeartRateVariabilityRmssd" && p.accessType === "read")) {
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
