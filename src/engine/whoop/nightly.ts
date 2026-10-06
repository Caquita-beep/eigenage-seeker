import { addDays, nightOf, type Nightly } from "../nights";
import type { Cycle, Member, Sleep } from "./types";

/**
 * WHOOP's records, filed under Exposure's nights (`exposure/nights.ts`).
 *
 * WHOOP does not think in calendar days: a cycle runs from one sleep to the
 * next, and a recovery belongs to the sleep it was measured from. Exposure
 * keys everything by the evening a night begins on. The join between the two
 * is the sleep's own start time at the member's own offset, so:
 *
 *   - HRV and RHR come from a recovery, and go to the night of the sleep it
 *     names — the sleep that began that evening, measured on waking.
 *   - Sleep duration goes to the night it began on.
 *   - Strain is the day's load BEFORE the night: a cycle opens at the sleep of
 *     night t and accumulates over the waking day after it, so its strain sits
 *     beside night t + 1 — the night that day ends in, whose morning HRV it can
 *     move. Strain is a covariate, never the outcome (HACKATHON.md, "adjust for
 *     strain, not for sleep").
 *
 * Absent stays absent. An unscored night, a strap left on the charger, the cycle
 * still running today — none becomes a zero, because a zero is a reading and
 * these are not.
 */

export interface Body {
  /** rMSSD in ms, on waking after the night. */
  rmssd: Nightly;
  /** Resting heart rate, bpm, on waking after the night. */
  rhr: Nightly;
  /** Hours asleep (light + slow wave + REM), of the sleep that began that evening. */
  sleep: Nightly;
  /** WHOOP day strain, 0–21, of the waking day that ends in the night. */
  strain: Nightly;
  /** What was left out and why, so a thin history can say what thinned it. */
  skipped: { naps: number; unscored: number; unmatched: number; open: number; shorter: number };
}

/** "-05:00" → -300. WHOOP writes the offset this way; "Z" is accepted too. */
export function offsetMinutes(tz: string): number {
  if (tz === "Z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) throw new Error(`Unreadable timezone offset: ${tz}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

const unix = (iso: string) => Date.parse(iso) / 1000;

function nightOfSleep(s: Sleep): string {
  return nightOf(unix(s.start), offsetMinutes(s.timezone_offset));
}

function strainNight(c: Cycle): string {
  return addDays(nightOf(unix(c.start), offsetMinutes(c.timezone_offset)), 1);
}

export function toNightly({ recoveries, sleeps, cycles }: Member): Body {
  const skipped = { naps: 0, unscored: 0, unmatched: 0, open: 0, shorter: 0 };

  // One main sleep per night. Two can happen — up at 2 a.m., back to bed at 3 —
  // and the longer is the night's sleep; the recovery that names the other is
  // left out rather than averaged in, because averaging two HRV readings taken
  // on different sleeps makes a number neither sleep produced.
  const main = new Map<string, Sleep>();
  for (const s of sleeps) {
    if (s.nap) {
      skipped.naps++;
      continue;
    }
    const night = nightOfSleep(s);
    const held = main.get(night);
    if (!held) {
      main.set(night, s);
      continue;
    }
    skipped.shorter++;
    if (unix(s.end) - unix(s.start) > unix(held.end) - unix(held.start)) main.set(night, s);
  }

  const sleepById = new Map<string, string>();
  const sleep: Nightly = new Map();
  for (const [night, s] of main) {
    sleepById.set(s.id, night);
    if (s.score_state !== "SCORED" || !s.score) continue;
    const st = s.score.stage_summary;
    const asleep = st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli;
    sleep.set(night, asleep / 3_600_000);
  }

  const rmssd: Nightly = new Map();
  const rhr: Nightly = new Map();
  for (const r of recoveries) {
    if (r.score_state !== "SCORED" || !r.score) {
      skipped.unscored++;
      continue;
    }
    // A recovery whose sleep was a nap, the shorter of two, or outside the
    // window has no night of its own here.
    const night = sleepById.get(r.sleep_id);
    if (!night) {
      skipped.unmatched++;
      continue;
    }
    // `user_calibrating` concerns WHOOP's recovery SCORE, which Exposure never
    // reads; the rMSSD under it is a measurement either way.
    rmssd.set(night, r.score.hrv_rmssd_milli);
    rhr.set(night, r.score.resting_heart_rate);
  }

  const strain: Nightly = new Map();
  for (const c of cycles) {
    // Today's cycle is still accumulating; half a day's strain would read as a
    // light day.
    if (!c.end) {
      skipped.open++;
      continue;
    }
    if (c.score_state !== "SCORED" || !c.score) {
      skipped.unscored++;
      continue;
    }
    strain.set(strainNight(c), c.score.strain);
  }

  return { rmssd, rhr, sleep, strain, skipped };
}
