/**
 * Every series in Exposure is keyed by NIGHT, named after its evening.
 *
 * The question is "does what happened today show up in the body tomorrow
 * morning?", and the thing that connects the two is the night between them. So
 * the night of 2026-09-10 owns:
 *
 *   - the market's day of 10 September (the move you went to bed on),
 *   - on-chain activity from 18:00 on the 10th to 05:00 on the 11th, local,
 *   - the sleep that began that evening and the HRV measured on waking on the
 *     11th.
 *
 * With that one convention, "day t → morning t+1" is lag zero and every join is
 * a plain key match. Getting this wrong is the most likely silent bug in the
 * feature — a 2 a.m. swap filed under the wrong date pairs with the wrong
 * morning and quietly dilutes any real effect to nothing — which is why it is
 * one function, tested at the edges.
 *
 * Wall-clock only. `offsetMinutes` is the reader's UTC offset (Ecuador: -300).
 * A fixed offset is wrong across a DST change by an hour, which matters only for
 * transactions within an hour of the 05:00 boundary; accepted.
 */

/** A value per night. Keys are `YYYY-MM-DD`, the evening's date. */
export type Nightly = Map<string, number>;

/** Before this hour, local, an event belongs to the previous evening's night. */
export const NIGHT_ENDS_HOUR = 5;

/** Local wall-clock parts of a unix time, at a fixed UTC offset. */
export function localParts(unixSeconds: number, offsetMinutes: number) {
  const d = new Date((unixSeconds + offsetMinutes * 60) * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday. Of the evening, so a Friday night is a 5. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Which night a moment belongs to. */
export function nightOf(unixSeconds: number, offsetMinutes: number): string {
  const { date, hour } = localParts(unixSeconds, offsetMinutes);
  return hour < NIGHT_ENDS_HOUR ? addDays(date, -1) : date;
}

/**
 * Minutes past the evening's 18:00, so that 23:30 and 01:30 sort in the order
 * they happened: 330 and 450. Negative for daytime.
 */
export function minutesIntoNight(unixSeconds: number, offsetMinutes: number): number {
  const { hour, minute } = localParts(unixSeconds, offsetMinutes);
  const h = hour < NIGHT_ENDS_HOUR ? hour + 24 : hour;
  return (h - 18) * 60 + minute;
}
