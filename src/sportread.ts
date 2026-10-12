import { useMemo } from "react";
import { useExposure } from "./data";
import { addDays } from "./engine/nights";
import { morning, useJournal } from "./journalread";
import { drivers, fromNormal, OUTCOMES, sizesByNight, type Drivers, type Outcome } from "./drivers";
import { BODY, type Tone } from "./insight";
import { extremes, HEAVY, loadWeeks, mix, rhythm, sessions, side, splits, type Mix, type Session, type Side, type Zone } from "./sport";
import { tradingWeek, type TradingWeek } from "./walletread";
import { moonNights } from "./moon";

/**
 * The sport layer (`sport.ts`) read once for a screen: Today shows the load
 * and the intensity, Insights the conditions and the correlations. Null until
 * the wallet, the journal and the series are in.
 */

export type MixWindow = "week" | "month" | "all";

export interface Sport {
  sessions: Session[];
  tw: TradingWeek;
  weeks: ReturnType<typeof loadWeeks>;
  rhythm: ReturnType<typeof rhythm>;
  /** Heavier weeks against the rest, and the HRV of their nights; null without both. */
  heavy: { heavy: Side; other: Side; weeks: number } | null;
  /** The intensity counts over the last 7 nights, 28 nights, and all history. */
  mixes: Record<MixWindow, Mix>;
  zones: Record<Zone, Side>;
  rest: Side;
  splits: ReturnType<typeof splits>;
  extremes: ReturnType<typeof extremes>;
  /** For each outcome, its drivers ranked (`drivers.ts`). */
  corr: Record<Outcome, Drivers>;
  timeline: Timeline;
}

/** The last TIMELINE nights, aligned: the body, the trading and the money, night by night. */
export interface Timeline {
  nights: string[];
  /** That morning's assessment, as its tone; null without one. */
  tone: (Tone | null)[];
  /** The next morning's HRV against the 60 nights before, in percent; null without a reading. */
  hrv: (number | null)[];
  /** Share of the wallet moved, 0 on rest days. */
  moved: number[];
  zone: (Zone | null)[];
  /** Realised profit summed from the window's start. */
  pnl: number[];
}

export const TIMELINE = 90;

export function useSport(): Sport | null {
  const { data } = useExposure();
  const { journal: j, wallet } = useJournal();
  return useMemo(() => {
    const share = data?.["wallet:share"];
    if (!data || !wallet || !j || !share?.size) return null;
    const ss = sessions(data);
    const nights = [...share.keys()].sort();
    const last = nights[nights.length - 1];
    const realised = new Map<string, number>();
    for (const f of j.ledger.fills) if (f.pnl !== null) realised.set(f.night, (realised.get(f.night) ?? 0) + f.pnl);
    const traded = new Set(ss.map((x) => x.night));
    const zone = (z: Zone) => side(data, realised, ss.filter((x) => x.zone === z).map((x) => x.night));
    // Heavier weeks against the rest: complete weeks at half again the four before them, and their nights' HRV.
    const full = loadWeeks(data, Infinity).filter((w) => w.complete && w.chronic);
    const weekNights = (ws: typeof full) => ws.flatMap((w) => [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(w.week, k)));
    const hv = full.filter((w) => w.load / w.chronic! >= HEAVY);
    const ot = full.filter((w) => w.load / w.chronic! < HEAVY);
    const heavy = hv.length && ot.length ? { heavy: side(data, realised, weekNights(hv)), other: side(data, realised, weekNights(ot)), weeks: hv.length } : null;
    // Moonlight for every night the series cover (`moon.ts`), on the reader's clock.
    const moon = moonNights(new Set([...nights, ...(data["health:ln"]?.keys() ?? [])]), -new Date().getTimezoneOffset());
    const sp = splits(data, ss, realised, (n) => morning(j, n)?.split ?? null, moon);
    return {
      sessions: ss,
      tw: tradingWeek(wallet),
      weeks: loadWeeks(data, 12),
      rhythm: rhythm(data),
      heavy: heavy?.heavy.hrv && heavy.other.hrv ? heavy : null,
      mixes: { week: mix(ss, last, 7), month: mix(ss, last, 28), all: mix(ss, last, nights.length) },
      zones: { easy: zone("easy"), moderate: zone("moderate"), hard: zone("hard") },
      rest: side(data, realised, nights.filter((n) => !traded.has(n))),
      splits: sp,
      extremes: extremes(sp),
      timeline: (() => {
        const tl = nights.slice(-TIMELINE);
        const dev = fromNormal(data["health:ln"]);
        const zoneOf = new Map(ss.map((x) => [x.night, x.zone]));
        let run = 0;
        return {
          nights: tl,
          tone: tl.map((n) => {
            const m = morning(j, n);
            return m ? BODY[m.response].tone : null;
          }),
          hrv: tl.map((n) => (dev?.has(n) ? 100 * (Math.exp(dev.get(n)!) - 1) : null)),
          moved: tl.map((n) => share.get(n) ?? 0),
          zone: tl.map((n) => zoneOf.get(n) ?? null),
          pnl: tl.map((n) => (run += realised.get(n) ?? 0)),
        };
      })(),
      corr: (() => {
        const sizes = sizesByNight(j.ledger.fills);
        return Object.fromEntries(OUTCOMES.map((o) => [o.key, drivers(data, sizes, moon, o.key)])) as Record<Outcome, Drivers>;
      })(),
    };
  }, [data, wallet, j]);
}
