import { banded, type Position, type Response, type Trend } from "./hrv";
import { addDays, minutesIntoNight, nightOf, type Nightly } from "./nights";
import { bootstrapInterval, effect, type Row } from "./stats";
import { SOL } from "./wallet";

/**
 * How the reader's trades went, against the state they were in — and what
 * following the risk budget would have changed.
 *
 * ── A trade's result ─────────────────────────────────────────────────────
 * The coin's move over the `horizon` days after the trade, from the trade's
 * own price to the daily close `horizon` days on: a buy did well if the coin
 * then rose, a sell if it then fell. A standard way to score entries that
 * needs no matching of buys to sells, and the same yardstick for every coin.
 * A trade too recent for its horizon to have passed is left out, not guessed.
 *
 * ── What was known that morning, and nothing later ───────────────────────
 * Each trade is filed under its night (`nights.ts`), and read against the
 * body as it stood on waking that day — the trend of the night before, whose
 * bands look only backwards — and the market as it stood on the trade's day:
 * DVOL's last 7 days against the 365 before. No result is explained by
 * anything that happened after the trade.
 *
 * ── The backtest ─────────────────────────────────────────────────────────
 * Every buy replayed at the risk budget the Today screen would have shown
 * that morning (`insight.ts` in the app: body factor × volatility factor),
 * and not at all where it would have said to stand aside. Sells are kept as
 * they were: cutting risk is always allowed. Same trades, same prices; only
 * the size changes. Keep the factors here in step with `insight.ts`.
 */

export interface PerfTrade {
  /** ms since epoch. */
  t: number;
  mint: string;
  side: "buy" | "sell";
  amount: number;
  usd: number | null;
}

export interface PerfInput {
  trades: PerfTrade[];
  /** Daily USD close by UTC date, per mint. SOL's is also the market's swings. */
  closes: Record<string, Nightly>;
  offsetMinutes: number;
  /** The body's trend by night (`hrv.ts`, `trends`). */
  trends: Map<string, Trend>;
  /** DVOL daily, for the market side of the budget. */
  dvol?: Nightly;
  horizon: number;
}

export type BodyGroup = "steady" | "acute" | "down";

export interface TradeResult {
  t: number;
  night: string;
  mint: string;
  side: "buy" | "sell";
  usd: number;
  /** Signed: positive when the trade was on the right side of the next `horizon` days. */
  ret: number;
  pnl: number;
  response: Response | null;
  body: BodyGroup | null;
  market: Position | null;
  late: boolean;
  /** The size the risk budget would have allowed, as a share of the actual (0 to 1). */
  budget: number;
}

export const bodyGroup = (r: Response): BodyGroup => (r === "coping" || r === "stable" ? "steady" : r === "acute" ? "acute" : "down");

/** Same factors as the Today screen's risk budget. */
const BODY_FACTOR: Record<BodyGroup, number> = { steady: 1, acute: 0.8, down: 0.6 };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function closeOn(c: Nightly, keys: string[], day: string): number | null {
  if (c.has(day)) return c.get(day)!;
  let best: string | null = null;
  for (const d of keys) if (d <= day) best = d;
  return best ? c.get(best)! : null;
}

export interface BudgetInput {
  /** Daily USD close by UTC date; SOL's is read for the market's swings. */
  closes: Record<string, Nightly>;
  offsetMinutes: number;
  trends: Map<string, Trend>;
  dvol?: Nightly;
}

export interface Budgeted {
  night: string;
  response: Response | null;
  body: BodyGroup | null;
  market: Position | null;
  /** The size Today's advice allowed, as a share of what was traded (0 to 1). Sells always 1. */
  budget: number;
}

/** For any trade, the state that morning and the size Today's advice would have allowed. */
export function riskBudget(i: BudgetInput): (t: { t: number; side: "buy" | "sell" }) => Budgeted {
  // The market as it stood each day: DVOL's last 7 days against its band, and against the year before.
  const dvolDays = i.dvol ? [...i.dvol.keys()].sort() : [];
  const dvolBand = i.dvol ? banded(i.dvol) : null;
  const marketOn = (day: string) => {
    if (!i.dvol || !dvolDays.length) return { position: null as Position | null, factor: 1 };
    const upTo = dvolDays.filter((d) => d <= day);
    if (upTo.length < 60) return { position: null, factor: 1 };
    const week = upTo.slice(-7).map((d) => i.dvol!.get(d)!);
    const year = upTo.slice(-365).map((d) => i.dvol!.get(d)!);
    return { position: dvolBand?.get(upTo[upTo.length - 1])?.position ?? null, factor: Math.min(1, median(year) / mean(week)) };
  };

  // SOL's actual swings, banded the same way: "turbulent" is the last 7 days' swings above their normal.
  const sol = i.closes[SOL];
  const swings: Nightly = new Map();
  if (sol) {
    const d = [...sol.keys()].sort();
    for (let k = 1; k < d.length; k++) swings.set(d[k], Math.abs(Math.log(sol.get(d[k])! / sol.get(d[k - 1])!)));
  }
  const swingBand = swings.size ? banded(swings) : null;

  return (tr) => {
    const day = new Date(tr.t).toISOString().slice(0, 10);
    const night = nightOf(tr.t / 1000, i.offsetMinutes);
    const trend = i.trends.get(addDays(night, -1)) ?? null;
    const body = trend ? bodyGroup(trend.response) : null;
    const m = marketOn(day);
    const turbulent = swingBand?.get(day)?.position === "above";
    const standAside = turbulent && (body === "down" || body === "acute");
    const budget = tr.side === "sell" ? 1 : standAside ? 0 : (body ? BODY_FACTOR[body] : 1) * m.factor;
    return { night, response: trend?.response ?? null, body, market: m.position, budget };
  };
}

export function tradeResults(i: PerfInput): TradeResult[] {
  const keys: Record<string, string[]> = Object.fromEntries(Object.entries(i.closes).map(([m, c]) => [m, [...c.keys()].sort()]));
  const budgetOf = riskBudget(i);

  const out: TradeResult[] = [];
  for (const tr of i.trades) {
    const c = i.closes[tr.mint];
    if (!c || !tr.usd || tr.amount <= 0) continue;
    const day = new Date(tr.t).toISOString().slice(0, 10);
    const exitDay = addDays(day, i.horizon);
    const last = keys[tr.mint][keys[tr.mint].length - 1];
    if (!last || exitDay > last) continue;
    const entry = tr.usd / tr.amount;
    const exit = closeOn(c, keys[tr.mint], exitDay);
    if (!exit || !(entry > 0)) continue;
    const move = exit / entry - 1;
    const ret = tr.side === "buy" ? move : -move;
    const b = budgetOf(tr);

    out.push({
      t: tr.t,
      night: b.night,
      mint: tr.mint,
      side: tr.side,
      usd: tr.usd,
      ret,
      pnl: tr.usd * ret,
      response: b.response,
      body: b.body,
      market: b.market,
      late: minutesIntoNight(tr.t / 1000, i.offsetMinutes) >= 360,
      budget: b.budget,
    });
  }
  return out;
}

export interface Group {
  key: string;
  n: number;
  /** Mean signed result per trade. */
  mean: number | null;
  /** Share of trades on the right side. */
  won: number | null;
  pnl: number;
}

export function groupBy(results: TradeResult[], key: (r: TradeResult) => string | null, order: string[]): Group[] {
  return order.map((k) => {
    const g = results.filter((r) => key(r) === k);
    return {
      key: k,
      n: g.length,
      mean: g.length ? mean(g.map((r) => r.ret)) : null,
      won: g.length ? g.filter((r) => r.ret > 0).length / g.length : null,
      pnl: g.reduce((s, r) => s + r.pnl, 0),
    };
  });
}

/** Trades in time order may share a run of days; resample them in blocks of this many. */
const BLOCK = 5;
/** Each side needs this many trades before a difference is worth stating. */
export const MIN_SIDE = 8;

export interface Difference {
  /** Mean result where `when` held, minus the rest. */
  effect: number;
  interval: [number, number];
  n: [number, number];
  detected: boolean;
}

/** The difference in mean result between trades where `when` held and the rest, with a block-bootstrap interval. */
export function difference(results: TradeResult[], when: (r: TradeResult) => boolean | null, confidence = 0.9): Difference | null {
  const rows: Row[] = [];
  for (const r of [...results].sort((a, b) => a.t - b.t)) {
    const w = when(r);
    if (w === null) continue;
    rows.push({ x: w ? 1 : 0, y: r.ret, weekday: null, covariates: [] });
  }
  return compare(rows, confidence);
}

/**
 * ── How the reader trades, by the body's state ────────────────────────────
 * The two kinds of morning the Today screen tells apart: steady (coping well
 * or stable) and strained (acute stress, maladaptation or fatigue). On each,
 * how many trades a day, how big, and how many after midnight. Needs no
 * prices, so it is there as soon as the trades are. Days with no trade count
 * as days, so "trades a day" is a rate, not an average over active days.
 * Sizes are compared on a log scale: one whale trade should not decide it.
 */

export type Split = "steady" | "strained";

export const splitOf = (b: BodyGroup | null): Split | null => (b === null ? null : b === "steady" ? "steady" : "strained");

export interface HabitSide {
  days: number;
  trades: number;
  /** Trades per day, days with no trade included. */
  perDay: number | null;
  /** Typical trade in USD: the geometric mean, so one outlier does not set it. */
  size: number | null;
  /** Share of trades after midnight. */
  late: number | null;
}

export interface Habits {
  steady: HabitSide;
  strained: HabitSide;
  /** Strained minus steady, in trades a day. */
  perDay: Difference | null;
  /** Strained minus steady, in log USD per trade: exp(effect) is the ratio. */
  size: Difference | null;
  /** Strained minus steady, in share of trades after midnight. */
  late: Difference | null;
}

export function habits(i: { trades: PerfTrade[]; trends: Map<string, Trend>; offsetMinutes: number; confidence?: number }): Habits {
  const confidence = i.confidence ?? 0.9;
  const byNight = new Map<string, PerfTrade[]>();
  for (const t of i.trades) {
    const night = nightOf(t.t / 1000, i.offsetMinutes);
    byNight.set(night, [...(byNight.get(night) ?? []), t]);
  }
  const nights = [...byNight.keys()].sort();
  const sideOf = (night: string) => {
    const tr = i.trends.get(addDays(night, -1));
    return tr ? splitOf(bodyGroup(tr.response)) : null;
  };

  const dayRows: Row[] = [];
  const sizeRows: Row[] = [];
  const lateRows: Row[] = [];
  const acc = { steady: { days: 0, trades: 0, logs: [] as number[], late: 0 }, strained: { days: 0, trades: 0, logs: [] as number[], late: 0 } };
  if (nights.length) {
    for (let d = nights[0]; d <= nights[nights.length - 1]; d = addDays(d, 1)) {
      const side = sideOf(d);
      if (!side) continue;
      const x = side === "strained" ? 1 : 0;
      const ts = byNight.get(d) ?? [];
      const a = acc[side];
      a.days++;
      a.trades += ts.length;
      dayRows.push({ x, y: ts.length, weekday: null, covariates: [] });
      for (const t of [...ts].sort((p, q) => p.t - q.t)) {
        const late = minutesIntoNight(t.t / 1000, i.offsetMinutes) >= 360;
        if (late) a.late++;
        lateRows.push({ x, y: late ? 1 : 0, weekday: null, covariates: [] });
        if (t.usd && t.usd > 0) {
          a.logs.push(Math.log(t.usd));
          sizeRows.push({ x, y: Math.log(t.usd), weekday: null, covariates: [] });
        }
      }
    }
  }
  const side = (a: (typeof acc)["steady"]): HabitSide => ({
    days: a.days,
    trades: a.trades,
    perDay: a.days ? a.trades / a.days : null,
    size: a.logs.length ? Math.exp(mean(a.logs)) : null,
    late: a.trades ? a.late / a.trades : null,
  });
  return {
    steady: side(acc.steady),
    strained: side(acc.strained),
    perDay: compare(dayRows, confidence),
    size: compare(sizeRows, confidence),
    late: compare(lateRows, confidence),
  };
}

function compare(rows: Row[], confidence: number): Difference | null {
  const yes = rows.filter((r) => r.x === 1).length;
  const no = rows.length - yes;
  if (yes < MIN_SIDE || no < MIN_SIDE) return null;
  const e = effect(rows);
  const interval = bootstrapInterval(rows, confidence, { block: BLOCK });
  if (e === null || !interval) return null;
  return { effect: e, interval, n: [yes, no], detected: interval[0] > 0 || interval[1] < 0 };
}

export interface Backtest {
  actual: { pnl: number; staked: number };
  budget: { pnl: number; staked: number };
  /** Buys the budget would have skipped outright. */
  skipped: number;
  /** Where the difference came from: on days the body was down, and the rest. */
  downDays: { actual: number; budget: number };
}

export function backtest(results: TradeResult[]): Backtest {
  const sum = (f: (r: TradeResult) => number, rs = results) => rs.reduce((s, r) => s + f(r), 0);
  const down = results.filter((r) => r.body === "down");
  return {
    actual: { pnl: sum((r) => r.pnl), staked: sum((r) => r.usd) },
    budget: { pnl: sum((r) => r.pnl * r.budget), staked: sum((r) => r.usd * r.budget) },
    skipped: results.filter((r) => r.side === "buy" && r.budget === 0).length,
    downDays: { actual: sum((r) => r.pnl, down), budget: sum((r) => r.pnl * r.budget, down) },
  };
}
