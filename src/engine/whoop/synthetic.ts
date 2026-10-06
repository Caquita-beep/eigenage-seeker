import { addDays, weekday } from "../nights";
import { rng } from "../stats";
import { PAGE_LIMIT, type Collection, type Fetcher } from "./client";
import { offsetMinutes } from "./nightly";
import type { Cycle, Member, Recovery, Sleep } from "./types";

/**
 * A WHOOP member who does not exist, for building against until one does.
 *
 * ── What it is for ────────────────────────────────────────────────────────
 * Nobody on the team has a WHOOP, so nothing about the integration can be
 * checked against a real account yet. This generates a history in WHOOP's own
 * v2 shapes — recoveries, sleeps and cycles, linked by id the way WHOOP links
 * them, paged the way WHOOP pages them — so the fetcher, the paging, the
 * mapping to nights and the Altini reading all run end to end, and the first
 * real account swaps one function (`apiFetcher` for `syntheticFetcher`).
 *
 * ── What it is NOT ────────────────────────────────────────────────────────
 * A measurement, a norm, or anybody's data. Every constant below was chosen to
 * look like a plausible adult, not taken from a source, and nothing here may be
 * shown without saying it is synthetic (HANDOFF.md: never fabricate a value).
 * By default it is not coupled to the market: no planted effect links this
 * body to DVOL or to any wallet, so the questions run on it should find
 * nothing — and if they do, that is a false positive worth knowing about.
 *
 * ── A planted link, for a demo, on request ───────────────────────────────
 * Given `fear` (DVOL by date), nights in a fearful market swing more: the
 * night's noise grows with DVOL above its own median, so the week's CV
 * follows the fear. Drawn from its own random stream, so turning it on
 * changes nothing else about the member. It exists so the questions have
 * something real to find in a demo; the screens still say synthetic.
 *
 * A wallet's late nights lowering the next morning's HRV was tried and left
 * out: the synthetic trader already trades heavier after a low morning, so
 * planting the reverse too made that finding read as two-way.
 *
 * ── What it contains, so the page has something to read ─────────────────
 * Night-to-night noise (AR(1) on ln rMSSD), a Friday/Saturday dip, a strain
 * effect on the next morning, and — unless `episodes: false` — three planted
 * episodes, one per state the reading should be able to name:
 *
 *   illness    a week, HRV down hard and RHR up       → strained
 *   load       3½ weeks of baseline sliding and back  → suppressed
 *   travel     5 nights swinging up and down          → perturbed
 *
 * Travel ends about a week before last night, so a two-week view shows the
 * whole arc — steady, unsettled, steady again — on whichever day it is opened.
 *
 * And the mess real data has: naps, unscorable nights, the first nights
 * calibrating, and today's cycle still open.
 */

export interface SyntheticOptions {
  seed?: number;
  /** Nights of history. 210 is 30 weeks — over the 26 the weekly questions need. */
  days?: number;
  /** The evening of the most recent night. Defaults to the last night that has ended (`lastEndedNight`). */
  last?: string;
  /** WHOOP's format. Ecuador by default, like the rest of Exposure's tests. */
  timezoneOffset?: string;
  episodes?: boolean;
  /** DVOL by date: plants market fear → a less steady body. */
  fear?: Map<string, number>;
}

/** Not a WHOOP user id; nothing reads it. */
export const SYNTHETIC_USER_ID = 0;

// Chosen, not sourced — see above.
const LN_MEAN = Math.log(55);
const AR_PHI = 0.6;
const AR_SD = 0.11;
const WEEKEND_DIP = -0.08;
const PER_STRAIN = -0.012;
const RHR_MEAN = 56;
const RHR_PER_LN = -18;
const CALIBRATING_NIGHTS = 4;
const UNSCORABLE_RATE = 0.03;
const NAP_RATE = 0.06;
/** Planted, on request only: extra night-to-night swing per unit of DVOL over its median. */
const FEAR_SWING = 7;

/** Where each episode starts, as a fraction of the history, and its shape. */
const EPISODES: { at: number; ln: number[]; rhr: number[] }[] = [
  { at: 0.35, ln: [-0.25, -0.45, -0.5, -0.4, -0.3, -0.18, -0.08], rhr: [4, 8, 9, 7, 4, 2, 1] },
  {
    at: 0.62,
    ln: [...Array.from({ length: 18 }, (_, k) => (-0.24 * (k + 1)) / 18), ...[-0.2, -0.16, -0.12, -0.08, -0.04, -0.02]],
    rhr: [...Array.from({ length: 18 }, (_, k) => (4 * (k + 1)) / 18), ...[3, 3, 2, 2, 1, 0]],
  },
  { at: 0.94, ln: [0.25, -0.3, 0.27, -0.28, 0.22], rhr: [-1, 3, -1, 3, -1] },
];

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The most recent night that is over, on the member's own clock. Not
 * yesterday in UTC: at 20:30 in Ecuador it is already tomorrow in UTC, and a
 * night keyed to "yesterday UTC" would be tonight — a sleep that has not
 * happened, which the date window then drops. Before 10:00 local the night
 * that began yesterday evening may still be going, so the one before it is
 * the last that has ended.
 */
export function lastEndedNight(timezoneOffset: string, now = Date.now()): string {
  const local = new Date(now + offsetMinutes(timezoneOffset) * MIN);
  const today = local.toISOString().slice(0, 10);
  return addDays(today, local.getUTCHours() < 10 ? -2 : -1);
}

export function syntheticMember(opts: SyntheticOptions = {}): Member {
  const { seed = 1, days = 210, timezoneOffset = "-05:00", episodes = true } = opts;
  const last = opts.last ?? lastEndedNight(timezoneOffset);
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const uuid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = Math.floor(rand() * 16);
      return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  const offset = offsetMinutes(timezoneOffset);
  const first = addDays(last, -(days - 1));
  /** A local wall-clock time, as minutes past the evening's 18:00, in UTC ms. */
  const at = (night: string, minutesPast18: number) =>
    Date.parse(`${night}T18:00:00Z`) + minutesPast18 * MIN - offset * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();

  const lnShift = new Array<number>(days).fill(0);
  const rhrShift = new Array<number>(days).fill(0);
  if (episodes) {
    for (const e of EPISODES) {
      const start = Math.floor(e.at * days);
      e.ln.forEach((v, k) => start + k < days && (lnShift[start + k] += v));
      e.rhr.forEach((v, k) => start + k < days && (rhrShift[start + k] += v));
    }
  }

  // The night's sleep, and the strain of the waking day that ends in it.
  const nights = Array.from({ length: days }, (_, i) => {
    const night = addDays(first, i);
    const wd = weekday(night);
    const weekend = wd === 5 || wd === 6;
    const strain = Math.min(21, Math.max(2, 9 + 4 * rand() + gauss() * 2 + (wd === 6 || wd === 0 ? 1.5 : 0)));
    const onset = Math.min(570, Math.max(210, 330 + gauss() * 35 + (weekend ? 70 : 0)));
    const asleepH = Math.min(9.5, Math.max(4.5, 7.1 + gauss() * 0.5 - Math.max(0, onset - 360) / 120));
    const awakeMin = 20 + rand() * 30;
    return { night, wd, weekend, strain, onset, asleepH, awakeMin };
  });

  // HRV and RHR on waking after each night.
  const noise: number[] = [gauss() * AR_SD];
  for (let i = 1; i < days; i++) noise.push(AR_PHI * noise[i - 1] + gauss() * AR_SD * Math.sqrt(1 - AR_PHI * AR_PHI));
  // Planted links, from their own stream so the rest of the member is unchanged.
  const planted = new Array<number>(days).fill(0);
  if (opts.fear?.size) {
    const r2 = rng(seed + 7919);
    const g2 = () => Math.sqrt(-2 * Math.log(r2() || 1e-12)) * Math.cos(2 * Math.PI * r2());
    // Fear against its own median over this member's nights, so it is relative to the history shown.
    const vals = opts.fear ? nights.map((n) => opts.fear!.get(n.night)).filter((v): v is number => v !== undefined).sort((a, b) => a - b) : [];
    const mid = vals.length ? vals[vals.length >> 1] : 0;
    nights.forEach((n, i) => {
      const f = opts.fear?.get(n.night);
      const swing = f !== undefined && mid > 0 ? FEAR_SWING * Math.max(0, f / mid - 1) : 0;
      planted[i] += g2() * AR_SD * swing;
    });
  }
  const ln = nights.map((n, i) => LN_MEAN + (n.weekend ? WEEKEND_DIP : 0) + PER_STRAIN * (n.strain - 12) + lnShift[i] + noise[i] + planted[i]);
  const rhr = ln.map((v, i) => Math.round(RHR_MEAN + RHR_PER_LN * (v - LN_MEAN) + rhrShift[i] + gauss() * 1.5));

  const sleeps: Sleep[] = [];
  const cycles: Cycle[] = [];
  const recoveries: Recovery[] = [];

  nights.forEach((n, i) => {
    const start = at(n.night, n.onset);
    const asleep = n.asleepH * HOUR;
    const awake = n.awakeMin * MIN;
    const end = start + asleep + awake;
    // A cycle opens at this sleep and closes at the next; its strain is the
    // waking day between them, which ends in night i + 1.
    const next = nights[i + 1];
    const cycleId = 1_000_000 + i;
    const unscorable = i > 0 && rand() < UNSCORABLE_RATE;
    const sleepId = uuid();
    const stamp = iso(end + 2 * MIN);

    const light = asleep * (0.5 + rand() * 0.06);
    const sws = asleep * (0.18 + rand() * 0.05);
    sleeps.push({
      id: sleepId,
      cycle_id: cycleId,
      user_id: SYNTHETIC_USER_ID,
      created_at: stamp,
      updated_at: stamp,
      start: iso(start),
      end: iso(end),
      timezone_offset: timezoneOffset,
      nap: false,
      score_state: unscorable ? "UNSCORABLE" : "SCORED",
      score: unscorable
        ? undefined
        : {
            stage_summary: {
              total_in_bed_time_milli: Math.round(asleep + awake),
              total_awake_time_milli: Math.round(awake),
              total_no_data_time_milli: 0,
              total_light_sleep_time_milli: Math.round(light),
              total_slow_wave_sleep_time_milli: Math.round(sws),
              total_rem_sleep_time_milli: Math.round(asleep - light - sws),
              sleep_cycle_count: Math.round(n.asleepH / 1.5),
              disturbance_count: 5 + Math.floor(rand() * 10),
            },
            sleep_needed: {
              baseline_milli: 7.5 * HOUR,
              need_from_sleep_debt_milli: Math.round(rand() * 40 * MIN),
              need_from_recent_strain_milli: Math.round(Math.max(0, n.strain - 10) * 3 * MIN),
              need_from_recent_nap_milli: 0,
            },
            respiratory_rate: Math.round((14.5 + gauss() * 0.4) * 10) / 10,
            sleep_performance_percentage: Math.min(100, Math.round((n.asleepH / 7.5) * 100)),
            sleep_consistency_percentage: Math.round(60 + rand() * 30),
            sleep_efficiency_percentage: Math.round((asleep / (asleep + awake)) * 1000) / 10,
          },
    });

    const closed = next ? at(next.night, next.onset) : null;
    cycles.push({
      id: cycleId,
      user_id: SYNTHETIC_USER_ID,
      created_at: iso(start),
      updated_at: iso(closed ?? end),
      start: iso(start),
      end: closed ? iso(closed) : null,
      timezone_offset: timezoneOffset,
      score_state: "SCORED",
      // The open cycle's strain so far: a morning's worth. `toNightly` must
      // leave it out, and the test checks that it does.
      score: {
        strain: Math.round((next ? next.strain : 3) * 10) / 10,
        kilojoule: Math.round(6500 + (next ? next.strain : 3) * 450),
        average_heart_rate: Math.round(62 + (next ? next.strain : 3) * 0.8),
        max_heart_rate: Math.round(110 + (next ? next.strain : 3) * 3.5),
      },
    });

    // A nap in the waking day after this night, sometimes.
    if (next && rand() < NAP_RATE) {
      const napStart = at(n.night, 20 * 60 + Math.floor(rand() * 90)); // 14:00–15:30 the next day
      const napLen = (25 + rand() * 25) * MIN;
      sleeps.push({
        id: uuid(),
        cycle_id: cycleId,
        user_id: SYNTHETIC_USER_ID,
        created_at: iso(napStart + napLen),
        updated_at: iso(napStart + napLen),
        start: iso(napStart),
        end: iso(napStart + napLen),
        timezone_offset: timezoneOffset,
        nap: true,
        score_state: "SCORED",
        score: {
          stage_summary: {
            total_in_bed_time_milli: Math.round(napLen),
            total_awake_time_milli: Math.round(5 * MIN),
            total_no_data_time_milli: 0,
            total_light_sleep_time_milli: Math.round(napLen - 5 * MIN),
            total_slow_wave_sleep_time_milli: 0,
            total_rem_sleep_time_milli: 0,
            sleep_cycle_count: 0,
            disturbance_count: 1,
          },
          sleep_needed: { baseline_milli: 0, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 },
        },
      });
    }

    const v = Math.exp(ln[i]);
    recoveries.push({
      cycle_id: cycleId,
      sleep_id: sleepId,
      user_id: SYNTHETIC_USER_ID,
      created_at: stamp,
      updated_at: stamp,
      score_state: unscorable ? "UNSCORABLE" : "SCORED",
      score: unscorable
        ? undefined
        : {
            user_calibrating: i < CALIBRATING_NIGHTS,
            // WHOOP's recovery algorithm is not public. This is a stand-in
            // that rises with HRV and falls with RHR; Exposure never reads it.
            recovery_score: Math.min(99, Math.max(1, Math.round(55 + 180 * (ln[i] - LN_MEAN) - 2 * (rhr[i] - RHR_MEAN)))),
            resting_heart_rate: rhr[i],
            hrv_rmssd_milli: Math.round(v * 1000) / 1000,
          },
    });
  });

  // Newest first. Nothing downstream relies on the order.
  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  sleeps.sort((a, b) => desc(a.start, b.start));
  cycles.sort((a, b) => desc(a.start, b.start));
  recoveries.sort((a, b) => desc(a.created_at, b.created_at));
  return { recoveries, sleeps, cycles };
}

/**
 * The synthetic member behind the same interface as WHOOP: filtered to the
 * window by start time (a recovery by its cycle's), `limit` records a page,
 * with an opaque `next_token`.
 */
export function syntheticFetcher(member: Member): Fetcher {
  const cycleStart = new Map(member.cycles.map((c) => [c.id, c.start]));
  const records: Record<Collection, { at: string; record: unknown }[]> = {
    "v2/recovery": member.recoveries.map((r) => ({ at: cycleStart.get(r.cycle_id)!, record: r })),
    "v2/activity/sleep": member.sleeps.map((s) => ({ at: s.start, record: s })),
    "v2/cycle": member.cycles.map((c) => ({ at: c.start, record: c })),
  };
  return async (collection, q) => {
    const lo = Date.parse(q.start);
    const hi = Date.parse(q.end);
    const inWindow = records[collection].filter(({ at }) => Date.parse(at) >= lo && Date.parse(at) < hi);
    const from = q.nextToken ? Number(q.nextToken.slice("synthetic:".length)) : 0;
    const limit = Math.min(q.limit, PAGE_LIMIT);
    const page = inWindow.slice(from, from + limit).map((x) => x.record);
    const more = from + limit < inWindow.length;
    return { records: page, next_token: more ? `synthetic:${from + limit}` : null };
  };
}
