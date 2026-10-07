import type { Data } from "./engine/hypotheses";
import { addDays, type Nightly } from "./engine/nights";
import { weekOf } from "./engine/weeks";

/**
 * Trading as a sport: each day's trading is a session, with a load and an
 * intensity, and the body answers it in the next morning's HRV, the way training load is
 * read against HRV. Everything comes from what the app already holds; there
 * is nothing to fill in.
 *
 *   Load        the share of liquid holdings swapped (`wallet:share`), as
 *               on the Wallet tab: summed over a week, it is the week's load,
 *               and against the four weeks before it, acute against chronic
 *   Intensity   what made a session hard on the body. Three strains, each a
 *               yes or no: big size (twice the usual trading day), late (on
 *               chain between midnight and 5 am), and a big SOL move (SOL
 *               moved twice its usual). None is easy, one moderate, two or
 *               three hard. Product choices for words a trader can act on,
 *               not published thresholds
 *   Results     each trade scored by its coin's move over the next day
 *               (`engine/performance.ts`), and the profit its sells realised
 *
 * Nights are the journal's: a trade after midnight belongs to the evening
 * before, and a day pairs with the next morning's HRV: the sleep after it.
 */

export type Zone = "easy" | "moderate" | "hard";
export type Strain = "size" | "late" | "move";

/** Twice the usual trading day's load is big size. */
export const BIG = 2;
/** SOL moving twice its usual amount (`market:shock`) is a big SOL move. */
export const BIG_MOVE = 2;
/** The usual trading day: the median of the trading days in this many nights before. */
const USUAL_NIGHTS = 90;
/** Fewer trading days than this before it, and a day has no usual to be big against. */
const MIN_USUAL = 5;
/** Coming in heavier: the 7 nights before at half again the four weeks before them, as the Wallet tab's "Heavier". */
export const HEAVY = 1.5;
/** Each side needs this many scored trades before its result is shown as a figure. */
export const MIN_TRADES = 8;
/** And this many to be named the best or the worst: a headline should not rest on a handful. */
export const MIN_HEADLINE = 20;

export interface Session {
  night: string;
  load: number;
  zone: Zone;
  strains: Strain[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const sorted = (m: Nightly | undefined) => (m ? [...m.keys()].sort() : []);

/** Every trading day, oldest first, with its intensity. Days with no swap are rest days and not sessions. */
export function sessions(d: Data): Session[] {
  const share = d["wallet:share"];
  if (!share) return [];
  const awake = d["wallet:awake"];
  const shock = d["market:shock"];
  const traded: string[] = [];
  const out: Session[] = [];
  for (const night of sorted(share)) {
    const load = share.get(night)!;
    if (!(load > 0)) continue;
    const from = addDays(night, -USUAL_NIGHTS);
    const prior = traded.filter((n) => n >= from).map((n) => share.get(n)!);
    const usual = prior.length >= MIN_USUAL ? median(prior) : null;
    const strains: Strain[] = [];
    if (usual !== null && load >= BIG * usual) strains.push("size");
    if ((awake?.get(night) ?? 0) > 0) strains.push("late");
    if ((shock?.get(night) ?? 0) >= BIG_MOVE) strains.push("move");
    out.push({ night, load, strains, zone: strains.length >= 2 ? "hard" : strains.length ? "moderate" : "easy" });
    traded.push(night);
  }
  return out;
}

export interface Mix {
  easy: number;
  moderate: number;
  hard: number;
  /** Nights in the window with no swap. */
  rest: number;
  /** Nights in the window. */
  nights: number;
}

/** The intensity of the trading days in the `n` nights ending at `last`. */
export function mix(all: Session[], last: string, n: number, skip = 0): Mix {
  const to = addDays(last, -skip);
  const from = addDays(to, -(n - 1));
  const ss = all.filter((s) => s.night >= from && s.night <= to);
  const count = (z: Zone) => ss.filter((s) => s.zone === z).length;
  return { easy: count("easy"), moderate: count("moderate"), hard: count("hard"), rest: n - ss.length, nights: n };
}

export interface LoadWeek {
  /** The Monday that starts it. */
  week: string;
  load: number;
  /** Mean of the four weeks before; null without them. */
  chronic: number | null;
  /** False for the week still running. */
  complete: boolean;
}

/** Calendar weeks of load, Monday first, the last `n` of them, the running week included. */
export function loadWeeks(d: Data, n: number): LoadWeek[] {
  const share = d["wallet:share"];
  if (!share?.size) return [];
  const nights = sorted(share);
  const last = nights[nights.length - 1];
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const night of nights) {
    const w = weekOf(night);
    sums.set(w, (sums.get(w) ?? 0) + share.get(night)!);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const weeks = [...sums.keys()].sort();
  return weeks.slice(-n).map((week) => {
    const prior = [1, 2, 3, 4].map((k) => addDays(week, -7 * k));
    const full = prior.every((w) => counts.get(w) === 7);
    return {
      week,
      load: sums.get(week)!,
      chronic: full ? prior.reduce((s, w) => s + sums.get(w)!, 0) / 4 : null,
      complete: addDays(week, 6) <= last,
    };
  });
}

/** Trading days in a row, up to the last night; and rest days among the last 7 nights. */
export function rhythm(d: Data): { streak: number; rest: number } | null {
  const share = d["wallet:share"];
  if (!share?.size) return null;
  const nights = sorted(share);
  const last = nights[nights.length - 1];
  let streak = 0;
  for (let n = last; (share.get(n) ?? 0) > 0; n = addDays(n, -1)) streak++;
  let rest = 0;
  for (let k = 0; k < 7; k++) if (!((share.get(addDays(last, -k)) ?? 0) > 0)) rest++;
  return { streak, rest };
}

/** The 7 nights before `night` against the four weeks before them: how heavy the reader came into the day. */
export function comingIn(share: Nightly, night: string): number | null {
  const sum = (from: number, n: number) => {
    let s = 0;
    for (let k = from; k < from + n; k++) {
      const v = share.get(addDays(night, -k));
      if (v === undefined) return null;
      s += v;
    }
    return s;
  };
  const acute = sum(1, 7);
  const chronic = sum(8, 28);
  return acute === null || chronic === null || chronic <= 0 ? null : acute / (chronic / 4);
}

export interface Side {
  /** Nights on this side. */
  days: number;
  /** Trades scored by the next day's move. */
  trades: number;
  /** Mean next-day move per trade, signed for its side; null under MIN_TRADES. */
  mean: number | null;
  /** Share of trades the next day went the reader's way; null under MIN_TRADES. */
  won: number | null;
  /** What the side's sells realised, in USD. */
  realised: number;
  /** HRV those nights, ms (the geometric mean, as the body is read in ln); null without readings. */
  hrv: number | null;
  hrvNights: number;
}

/** What a set of nights adds up to: their trades' results, their realised profit, and the HRV of the sleep after. */
export function side(d: Data, realised: Map<string, number>, nights: string[]): Side {
  const res = d["wallet:result"];
  const n = d["wallet:resultN"];
  const won = d["wallet:resultWon"];
  const ln = d["health:ln"];
  let trades = 0;
  let sum = 0;
  let right = 0;
  let money = 0;
  let lns = 0;
  let hrvNights = 0;
  for (const night of nights) {
    const k = n?.get(night) ?? 0;
    if (k > 0) {
      trades += k;
      sum += (res?.get(night) ?? 0) * k;
      right += won?.get(night) ?? 0;
    }
    money += realised.get(night) ?? 0;
    const l = ln?.get(night);
    if (l !== undefined) {
      lns += l;
      hrvNights++;
    }
  }
  const enough = trades >= MIN_TRADES;
  return {
    days: nights.length,
    trades,
    mean: enough ? sum / trades : null,
    won: enough ? right / trades : null,
    realised: money,
    hrv: hrvNights ? Math.exp(lns / hrvNights) : null,
    hrvNights,
  };
}

export type Condition = "body" | "market" | "mood" | "clock" | "load";

export interface Split {
  key: Condition;
  label: string;
  a: { word: string; s: Side };
  b: { word: string; s: Side };
}

/**
 * The trading days split five ways, each by something known that morning or
 * that day: the body on waking (steady or strained, as the journal says), how
 * much SOL moved, the crowd's mood, the clock, and how heavy the week coming
 * in was.
 */
export function splits(d: Data, all: Session[], realised: Map<string, number>, morning: (night: string) => "steady" | "strained" | null): Split[] {
  const share = d["wallet:share"];
  const fng = d["market:fng"];
  const shock = d["market:shock"];
  const awake = d["wallet:awake"];
  const nights = all.map((s) => s.night);
  const by = (f: (n: string) => boolean | null) => [nights.filter((n) => f(n) === true), nights.filter((n) => f(n) === false)];
  const pair = (key: Condition, label: string, words: [string, string], f: (n: string) => boolean | null): Split => {
    const [a, b] = by(f);
    return { key, label, a: { word: words[0], s: side(d, realised, a) }, b: { word: words[1], s: side(d, realised, b) } };
  };
  return [
    pair("body", "Body that morning", ["Steady", "Strained"], (n) => {
      const m = morning(n);
      return m === null ? null : m === "steady";
    }),
    pair("market", "SOL that day", ["Normal", "Big move"], (n) => (shock?.has(n) ? shock.get(n)! < BIG_MOVE : null)),
    pair("mood", "Fear & Greed", ["Fear", "Greed"], (n) => {
      const v = fng?.get(n);
      return v === undefined || (v >= 45 && v <= 55) ? null : v < 45;
    }),
    pair("clock", "On-chain past midnight", ["No", "Yes"], (n) => (awake?.has(n) ? awake.get(n)! === 0 : null)),
    pair("load", "Previous 7 days", ["Usual", "Heavier"], (n) => {
      const r = share ? comingIn(share, n) : null;
      return r === null ? null : r < HEAVY;
    }),
  ];
}

/** The best and the worst conditions for the reader's trades: the sides with the highest and lowest mean, among those with MIN_HEADLINE trades. */
export function extremes(ss: Split[]): { best: { split: Split; word: string; s: Side }; worst: { split: Split; word: string; s: Side } } | null {
  const sides = ss.flatMap((split) => [
    { split, word: split.a.word, s: split.a.s },
    { split, word: split.b.word, s: split.b.s },
  ]).filter((x) => x.s.mean !== null && x.s.trades >= MIN_HEADLINE);
  if (sides.length < 2) return null;
  const order = [...sides].sort((x, y) => y.s.mean! - x.s.mean!);
  return { best: order[0], worst: order[order.length - 1] };
}
