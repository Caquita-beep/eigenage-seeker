import { useEffect, useMemo, useState } from "react";
import type { BodyNights } from "./body";
import { coinInfo, fetchQuotes, knownCoin } from "./coins";
import { useBody, useMarket, useWalletData } from "./data";
import { ASSESSMENT_SWC, trends, type Response, type Trend } from "./engine/hrv";
import type { Data } from "./engine/hypotheses";
import { buyOutcomes, ledger, openPositions, periods, type Fill, type Ledger, type Period, type PeriodKind } from "./engine/journal";
import { addDays } from "./engine/nights";
import { bodyGroup, riskBudget, splitOf, type Budgeted, type Split } from "./engine/performance";
import { SOL } from "./engine/wallet";
import type { Tone } from "./insight";
import type { MarketView } from "./market";
import type { WalletView } from "./walletview";

/**
 * The trading journal in plain words (`engine/journal.ts`): what was traded
 * each day, week or month, what it made or lost, and how it sat with the
 * body that morning.
 *
 *   Steady     that morning's assessment was Coping well or Stable
 *   Strained   Acute stress, Maladaptation or Accumulated fatigue
 *
 * Profit is first in, first out against the buys in the history; open
 * positions are at today's price. Only what was known that morning is used.
 */

export const money = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString()}`;
export const signed = (x: number) => `${x < -0.5 ? "−" : x > 0.5 ? "+" : ""}${money(x)}`;
export const toneOf = (x: number): Tone => (x > 0.5 ? "good" : x < -0.5 ? "bad" : "neutral");

export interface Journal {
  ledger: Ledger;
  trends: Map<string, Trend>;
  budgetOf: ((t: { t: number; side: "buy" | "sell" }) => Budgeted) | null;
  /** The typical buy over the whole history, in USD (median). */
  usualBuy: number | null;
  prices: Record<string, number> | null;
  symbols: Record<string, string>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function bodyTrends(body: BodyNights | null): Map<string, Trend> {
  return body ? trends(new Map(body.hrv), body.rhr.length ? new Map(body.rhr) : undefined, { swc: ASSESSMENT_SWC }) : new Map();
}

type Built = Omit<Journal, "prices" | "symbols">;

/**
 * The last journal built, by what it was built from. Today, the full journal
 * and a period's page all read the same one, so opening a page does not
 * rebuild the ledger, the body's trends and the risk budget each time.
 */
let last: { key: string; built: Built } | null = null;

function cached(wallet: WalletView, body: BodyNights | null, market: MarketView | null): Built {
  const key = `${wallet.asOf}|${wallet.acts}|${body?.importedAt ?? ""}|${market?.asOf ?? ""}`;
  if (last?.key !== key) last = { key, built: build(wallet, body, market) };
  return last.built;
}

function build(wallet: WalletView, body: BodyNights | null, market: MarketView | null): Built {
  const offset = -new Date().getTimezoneOffset();
  const trades = wallet.trades ?? [];
  const t = bodyTrends(body);
  const l = ledger(trades, offset);
  return {
    ledger: l,
    trends: t,
    budgetOf: market?.solBars.length
      ? riskBudget({
          closes: { [SOL]: new Map(market.solBars.map((b) => [b.day, b.close])) },
          dvol: market.dvolSeries.length ? new Map(market.dvolSeries.map((d) => [d.day, d.value])) : undefined,
          trends: t,
          offsetMinutes: offset,
        })
      : null,
    usualBuy: median(l.fills.filter((f) => f.side === "buy" && f.usd).map((f) => f.usd!)),
  };
}

/** The journal for the wallet, body and market the app holds. Prices and coin names arrive a moment later. */
export function useJournal(): { journal: Journal | null; wallet: WalletView | null } {
  const { view: wallet } = useWalletData();
  const { body } = useBody();
  const { view: market } = useMarket();
  const base = useMemo(() => (wallet ? cached(wallet, body, market) : null), [wallet, body, market]);
  const mints = useMemo(() => [...new Set((wallet?.trades ?? []).map((t) => t.mint))].sort().join(","), [wallet]);
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  const [symbols, setSymbols] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!mints) return;
    let live = true;
    const list = mints.split(",");
    fetchQuotes(list)
      .then((q) => live && setPrices(Object.fromEntries(Object.entries(q).map(([m, x]) => [m, x.price]))))
      .catch(() => live && setPrices({}));
    for (const m of list) {
      if (knownCoin(m)) continue;
      coinInfo(m)
        .then((c) => live && setSymbols((prev) => ({ ...prev, [m]: c.symbol })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [mints]);

  return { journal: base ? { ...base, prices, symbols } : null, wallet };
}

export const symbolOf = (j: Journal, mint: string) => knownCoin(mint)?.symbol ?? j.symbols[mint] ?? `${mint.slice(0, 4)}…`;

/** The morning's state for a night: the trend of the night before, as the Today screen read it. */
export function morning(j: Journal, night: string): { response: Response; split: Split } | null {
  const tr = j.trends.get(addDays(night, -1));
  return tr ? { response: tr.response, split: splitOf(bodyGroup(tr.response))! } : null;
}

// ── The summary at the top ────────────────────────────────────────────────

export interface Overview {
  realised: number;
  open: { value: number; cost: number } | null;
  trades: number;
  volume: number;
  winRate: number | null;
  /** Sells beyond the history's buys: coins held before it starts. */
  unmatched: number;
  advice: string | null;
}

export function overview(j: Journal): Overview {
  const fills = j.ledger.fills;
  const sells = fills.filter((f) => f.side === "sell" && f.pnl !== null);
  const won = sells.filter((f) => f.pnl! > 0).length;
  const lost = sells.filter((f) => f.pnl! < 0).length;
  const pos = j.prices ? openPositions(j.ledger.open, j.prices) : null;
  const open = pos && pos.every((p) => p.value !== null) ? { value: pos.reduce((s, p) => s + p.value!, 0), cost: pos.reduce((s, p) => s + p.cost, 0) } : null;
  return {
    realised: sells.reduce((s, f) => s + f.pnl!, 0),
    open,
    trades: fills.length,
    volume: fills.reduce((s, f) => s + (f.usd ?? 0), 0),
    winRate: won + lost ? won / (won + lost) : null,
    unmatched: fills.filter((f) => f.side === "sell" && f.unmatched > 0).length,
    advice: adviceLine(j),
  };
}

/** What following Today's advice would have changed: every buy at the size it allowed, same prices. */
function adviceLine(j: Journal): string | null {
  if (!j.budgetOf || !j.prices) return null;
  const outcomes = buyOutcomes(j.ledger, j.prices);
  let actual = 0;
  let advised = 0;
  let put = 0;
  let putAdvised = 0;
  for (const f of j.ledger.fills) {
    const o = outcomes.get(f.i);
    if (f.side !== "buy" || o === undefined || o === null || !f.usd) continue;
    const b = j.budgetOf(f).budget;
    actual += o;
    advised += o * b;
    put += f.usd;
    putAdvised += f.usd * b;
  }
  if (!put) return null;
  const less = Math.round(100 * (1 - putAdvised / put));
  return `Following Today's advice, your buys would have made ${signed(advised)} instead of ${signed(actual)}, with ${less}% less money put in.`;
}

// ── Periods and their notes ───────────────────────────────────────────────

export { periods, type Fill, type Period, type PeriodKind };

/** The plain notes for a period, most telling first. The list shows two; the period's own page shows all. */
export function notes(j: Journal, p: Period): string[] {
  const out: string[] = [];
  const nights: string[] = [];
  const lastNight = [...j.trends.keys()].sort().at(-1);
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (lastNight && addDays(d, -1) <= lastNight) nights.push(d);
  const strained = nights.filter((n) => morning(j, n)?.split === "strained");

  // Strained mornings, and what was bought on them.
  if (strained.length) {
    const set = new Set(strained);
    const buys = p.fills.filter((f) => f.side === "buy" && f.usd && set.has(f.night));
    const m = median(buys.map((f) => f.usd!));
    const k = strained.length === 1 ? (p.start === p.end ? "Strained morning" : "1 strained morning") : `${strained.length} strained mornings`;
    if (!p.fills.some((f) => set.has(f.night))) out.push(`${k}, no trades on ${strained.length === 1 ? "it" : "them"}.`);
    else if (m !== null && j.usualBuy && m >= 1.3 * j.usualBuy) out.push(`${k}; each buy ${(m / j.usualBuy).toFixed(1)}× your typical buy.`);
    else if (m !== null) out.push(`${k}; buys the size of your typical buy.`);
  }

  // The biggest result, and the morning its coins were bought on.
  const sells = p.fills.filter((f) => f.side === "sell" && f.pnl !== null);
  const big = sells.sort((a, b) => Math.abs(b.pnl!) - Math.abs(a.pnl!))[0];
  if (big && Math.abs(big.pnl!) >= 1) {
    const when = big.boughtNight ? morning(j, big.boughtNight)?.split : null;
    out.push(
      `${big.pnl! < 0 ? "Biggest loss" : "Best"}: ${symbolOf(j, big.mint)} ${signed(big.pnl!)}${when === "strained" ? ", bought on a strained morning" : when === "steady" ? ", bought on a steady morning" : ""}.`,
    );
  }

  const late = p.fills.filter((f) => f.late).length;
  if (late) out.push(`${late} trade${late === 1 ? "" : "s"} after midnight.`);

  const by = new Map<string, number>();
  for (const f of p.fills) by.set(f.mint, (by.get(f.mint) ?? 0) + (f.usd ?? 0));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && p.volume > 0) {
    if (by.size === 1) out.push(`All ${symbolOf(j, top[0])}.`);
    else if (top[1] / p.volume >= 0.6) out.push(`Mostly ${symbolOf(j, top[0])}.`);
  }
  return out;
}

/** The period's trades by coin: bought, sold and realised, largest first. */
export function byCoin(j: Journal, p: Period) {
  const by = new Map<string, { mint: string; symbol: string; trades: number; volume: number; realised: number }>();
  for (const f of p.fills) {
    const c = by.get(f.mint) ?? { mint: f.mint, symbol: symbolOf(j, f.mint), trades: 0, volume: 0, realised: 0 };
    c.trades++;
    c.volume += f.usd ?? 0;
    c.realised += f.pnl ?? 0;
    by.set(f.mint, c);
  }
  return [...by.values()].sort((a, b) => b.volume - a.volume);
}

/** A period's name: "Mon 21 Sep", "21 – 27 Sep", "September 2026". */
export function periodLabel(p: { start: string; end: string }, kind: PeriodKind): string {
  const d = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...o });
  if (kind === "day") return d(p.start, { weekday: "short", day: "numeric", month: "short" });
  if (kind === "month") return d(p.start, { month: "long", year: "numeric" });
  const sameMonth = p.start.slice(0, 7) === p.end.slice(0, 7);
  return sameMonth ? `${d(p.start, { day: "numeric" })} – ${d(p.end, { day: "numeric", month: "short" })}` : `${d(p.start, { day: "numeric", month: "short" })} – ${d(p.end, { day: "numeric", month: "short" })}`;
}

// ── The join, period by period ────────────────────────────────────────────

export interface Story {
  market: string | null;
  you: string;
  body: string | null;
  /** The period's biggest market day, what was traded on it, and the body the morning after. */
  join: string | null;
}

const pct1 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`;
const weekdayOf = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" });

export function story(j: Journal, p: Period, market: MarketView | null, data: Data | null): Story {
  // The market: SOL over the period, its biggest day, and whether options priced fear.
  let marketLine: string | null = null;
  let big: { day: string; ret: number } | null = null;
  if (market?.solBars.length) {
    const close = new Map(market.solBars.map((b) => [b.day, b.close]));
    const at = (d: string) => {
      for (let k = 0; k < 5; k++) {
        const c = close.get(addDays(d, -k));
        if (c !== undefined) return c;
      }
      return null;
    };
    const from = at(addDays(p.start, -1));
    const to = at(p.end);
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
      const a = close.get(addDays(d, -1));
      const b = close.get(d);
      if (a && b && (!big || Math.abs(b / a - 1) > Math.abs(big.ret))) big = { day: d, ret: b / a - 1 };
    }
    const dv = market.dvolSeries.filter((x) => x.day >= p.start && x.day <= p.end);
    const fearful = dv.filter((x) => x.high !== null && x.value > x.high).length;
    const calm = dv.filter((x) => x.low !== null && x.value < x.low).length;
    const mood = dv.length && fearful * 2 >= dv.length ? " · options priced fear" : dv.length && calm * 2 >= dv.length ? " · calm" : "";
    if (from && to) {
      marketLine =
        p.start === p.end
          ? `SOL ${pct1(to / from - 1)}${mood}`
          : `SOL ${pct1(to / from - 1)}${big ? ` · biggest day ${weekdayOf(big.day)} ${pct1(big.ret)}` : ""}${mood}`;
    }
  }

  // You: trades, what they realised, and where the coins stood against their cost at the end.
  const water = data?.["wallet:water"]?.get(p.end) ?? null;
  const you = [
    `${p.fills.length} trade${p.fills.length === 1 ? "" : "s"}`,
    Math.abs(p.realised) >= 1 ? `${signed(p.realised)} realised` : null,
    water !== null ? (water < 0 ? `ended ${Math.abs(100 * water).toFixed(0)}% underwater` : `ended ${Math.round(100 * water)}% above cost`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The body: strained mornings and nights below normal.
  const below = data?.["health:below"];
  let strained = 0;
  let low = 0;
  let seen = 0;
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
    const m = morning(j, d);
    if (m) seen++;
    if (m?.split === "strained") strained++;
    if (below?.get(d) === 1) low++;
  }
  const bodyLine = !seen
    ? null
    : strained || low
      ? [strained ? `${strained} strained morning${strained === 1 ? "" : "s"}` : null, low ? `HRV below normal ${low} night${low === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")
      : "Steady throughout";

  // The join: the biggest market day, what was done on it, and the HRV of the sleep after it, as shown the next morning.
  let join: string | null = null;
  if (big && Math.abs(big.ret) >= 0.03) {
    const n = p.fills.filter((f) => f.night === big!.day).length;
    const b = below?.get(big.day);
    const next = b === undefined ? null : b === 1 ? "HRV below your normal" : "HRV within your normal";
    join = `${weekdayOf(big.day)}: SOL ${pct1(big.ret)}, ${n ? `you made ${n} trade${n === 1 ? "" : "s"}` : "you did not trade"}${next ? ` → next morning, ${next}` : ""}.`;
  }
  return { market: marketLine, you, body: bodyLine, join };
}

/** The wallet's coins against what they cost, now: how many are underwater, and the total gap. */
export function positionNow(wallet: WalletView, prices: Record<string, number> | null) {
  if (!wallet.cost || !prices) return null;
  let cost = 0;
  let value = 0;
  let under = 0;
  let n = 0;
  for (const p of wallet.cost.now) {
    const price = prices[p.mint];
    if (!(p.costed > 0) || price === undefined) continue;
    n++;
    cost += p.cost;
    value += p.costed * price;
    if (p.costed * price < p.cost) under++;
  }
  return n ? { coins: n, under, gain: value - cost, pct: cost ? value / cost - 1 : 0 } : null;
}

// ── One day, for the next morning ─────────────────────────────────────────

export interface DaySummary {
  night: string;
  /** "Heavier than usual", "Usual", "Lighter than usual", "No trades". */
  word: string;
  tone: Tone;
  trades: number;
  /** Share of the wallet's SOL and stablecoins the day's swaps moved, and the average day's. */
  moved: number;
  usual: number | null;
  realised: number;
  /** How the day sat with the body it started with, in a sentence. */
  body: string | null;
  /** Anything else worth a line: past midnight, a big market day. */
  notes: string[];
}

const pct0 = (x: number) => `${Math.round(100 * x)}%`;

/**
 * A day of trading against the reader's own usual and the body they woke up
 * with: the Today screen's look back at yesterday. The usual is the average
 * day over the 60 before it, quiet days included, so "2× your usual" means
 * twice what a typical day moves.
 */
export function daySummary(j: Journal, wallet: WalletView, night: string, market: MarketView | null): DaySummary | null {
  const k = wallet.load.findIndex((p) => p.night === night);
  if (k < 0) return null;
  const day = wallet.load[k];
  const before = wallet.load.slice(Math.max(0, k - 60), k);
  const usual = before.length >= 14 ? before.reduce((s, p) => s + p.value, 0) / before.length : null;
  const ratio = usual ? day.value / usual : null;
  const fills = j.ledger.fills.filter((f) => f.night === night);
  const trades = fills.length;

  const [word, tone]: [string, Tone] =
    trades === 0
      ? ["No trades", "neutral"]
      : ratio === null
        ? ["Traded", "neutral"]
        : ratio >= 2
          ? ["Much heavier than usual", "bad"]
          : ratio >= 1.4
            ? ["Heavier than usual", "watch"]
            : ratio <= 0.5
              ? ["Lighter than usual", "good"]
              : ["Usual", "good"];

  // The body that morning, and what the day did with it.
  const m = morning(j, night);
  let body: string | null = null;
  if (m) {
    const state = BODY_WORD[m.response];
    const heavy = ratio !== null && ratio >= 1.4;
    if (m.split === "strained") {
      body =
        trades === 0
          ? `You woke ${state} and stayed out of the market. That is what the advice asks.`
          : heavy
            ? `You woke ${state} and moved ${ratio!.toFixed(1)}× your usual share of the wallet: the pattern the advice warns about.`
            : `You woke ${state} and moved no more of your wallet than usual.`;
    } else {
      body = heavy
        ? `You woke steady and had a busy day: ${ratio!.toFixed(1)}× your usual share of the wallet.`
        : trades === 0
          ? "You woke steady and did not trade."
          : "You woke steady and traded at your usual pace.";
    }
  }

  const notes: string[] = [];
  const late = fills.filter((f) => f.late);
  if (late.length) notes.push(`${late.length} trade${late.length === 1 ? "" : "s"} after midnight, the last at ${new Date(late[late.length - 1].t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`);
  if (market?.solBars.length) {
    const close = new Map(market.solBars.map((b) => [b.day, b.close]));
    const a = close.get(addDays(night, -1));
    const b = close.get(night);
    if (a && b && Math.abs(b / a - 1) >= 0.03) notes.push(`SOL moved ${pct1(b / a - 1)} that day.`);
  }

  return { night, word, tone, trades, moved: day.value, usual, realised: fills.reduce((s, f) => s + (f.pnl ?? 0), 0), body, notes };
}

/** The morning's state as an adjective, for "You woke …". */
const BODY_WORD: Record<Response, string> = {
  coping: "steady",
  stable: "steady",
  acute: "under acute stress",
  maladaptation: "strained",
  fatigue: "fatigued",
};

export { pct0 };

// ── The recap's history, and what it shows ────────────────────────────────

/** Every day's recap over the last `days`, newest first. */
export function recaps(j: Journal, wallet: WalletView, market: MarketView | null, days = 60): DaySummary[] {
  return wallet.load
    .slice(-days)
    .map((p) => daySummary(j, wallet, p.night, market))
    .filter((d): d is DaySummary => d !== null)
    .reverse();
}

export interface RecapInsight {
  text: string;
  tone: Tone;
}

/**
 * What the recaps show taken together: plain counts from the reader's own
 * days, not tests. A tested link lives on the Insights tab; these say how
 * the days actually went, so the reader can see it for themselves.
 */
export function recapInsights(j: Journal, list: DaySummary[], data: Data | null): RecapInsight[] {
  const out: RecapInsight[] = [];
  const heavy = (d: DaySummary) => d.usual !== null && d.trades > 0 && d.moved / d.usual >= 1.4;
  const strainedDays = list.filter((d) => morning(j, d.night)?.split === "strained");
  const span = `the last ${list.length} days`;

  if (strainedDays.length) {
    const against = strainedDays.filter(heavy).length;
    const kept = strainedDays.length - against;
    out.push({
      text: `On ${strainedDays.length} of ${span} you woke strained and the advice said to ease off. You kept to it on ${kept} and moved more of your wallet than usual on ${against}.`,
      tone: against > kept ? "bad" : against ? "watch" : "good",
    });
  }

  const heavyDays = list.filter(heavy);
  if (heavyDays.length >= 2) {
    const afterStrain = heavyDays.filter((d) => morning(j, d.night)?.split === "strained").length;
    const share = strainedDays.length / Math.max(1, list.filter((d) => morning(j, d.night)).length);
    out.push({
      text: `${afterStrain} of your ${heavyDays.length} heavier-than-usual days came after a strained morning${afterStrain / heavyDays.length > share + 0.1 ? `, though only ${Math.round(100 * share)}% of your mornings were strained` : ""}.`,
      tone: afterStrain / heavyDays.length > share + 0.1 ? "watch" : "neutral",
    });
  }

  const realised = (ds: DaySummary[]) => ds.reduce((s, d) => s + d.realised, 0);
  const usualDays = list.filter((d) => d.trades > 0 && !heavy(d));
  if (heavyDays.length >= 2 && usualDays.length >= 2) {
    const a = realised(heavyDays) / heavyDays.length;
    const b = realised(usualDays) / usualDays.length;
    if (Math.abs(a - b) >= 1) {
      out.push({ text: `Heavier days realised ${signed(a)} a day on average; your usual days ${signed(b)}.`, tone: a < b ? "watch" : "neutral" });
    }
  }

  const below = data?.["health:below"];
  const late = list.filter((d) => j.ledger.fills.some((f) => f.night === d.night && f.late));
  if (late.length && below) {
    const lowAfter = late.filter((d) => below.get(d.night) === 1).length;
    out.push({
      text: `You traded past midnight on ${late.length} of ${span}. Your HRV was below normal on ${lowAfter} of those nights.`,
      tone: lowAfter * 2 >= late.length ? "watch" : "neutral",
    });
  }
  return out;
}
