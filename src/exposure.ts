import type { BodyNights } from "./body";
import { coinInfo, dailyCloses, isStable } from "./coins";
import { assemble } from "./engine/assemble";
import { returnSeries, underwaterSeries } from "./engine/cost";
import { ledger } from "./engine/journal";
import { tradeResults } from "./engine/performance";
import { pressure } from "./engine/pressure";
import { SOL } from "./engine/wallet";
import { COIN_QUESTIONS, coinQuestion, HYPOTHESES, test, type Data, type Hypothesis, type Result } from "./engine/hypotheses";
import type { Nightly } from "./engine/nights";
import { loadRatio, weeklySum } from "./engine/weeks";
import type { MarketView } from "./market";
import type { WalletView } from "./wallet";

/**
 * Exposure on the phone: the market, the wallet and the body put into the
 * engine's registry of questions, each answered against this person's own
 * history or told what it is still waiting for.
 *
 * The registry and the statistics are the website's, unchanged (`engine/`).
 * What differs is the wallet: the app keeps nightly series rather than raw
 * transactions, so those series go straight into the data instead of through
 * `assemble`'s wallet step. They are the same series `walletNights` produces.
 */

export interface Answer {
  h: Hypothesis;
  r: Result;
}

const map = (pts: [string, number][]) => new Map(pts) as Nightly;

export function dataFor(market: MarketView, wallet: WalletView | null, body: BodyNights | null): Data {
  const d = assemble({
    sol: market.solBars,
    btc: market.btcBars.length ? market.btcBars : undefined,
    dvol: market.dvolSeries.length ? map(market.dvolSeries.map((x) => [x.day, x.value])) : undefined,
    solIndex: market.solIndexHistory.length ? map(market.solIndexHistory) : undefined,
    fng: market.fngSeries.length ? map(market.fngSeries) : undefined,
    rmssd: body?.hrv.length ? map(body.hrv) : undefined,
    strain: body?.strain?.length ? map(body.strain) : body?.energy.length ? map(body.energy) : undefined,
    sleep: body?.sleep.length ? map(body.sleep) : undefined,
    rhr: body?.rhr.length ? map(body.rhr) : undefined,
  });

  if (wallet?.load.length) {
    const series = (k: "awake" | "late" | "count" | "failed" | "swaps" | "usd") => map(wallet.load.map((p) => [p.night, p[k]]));
    d["wallet:awake"] = series("awake");
    d["wallet:late"] = series("late");
    d["wallet:count"] = series("count");
    d["wallet:failed"] = series("failed");
    d["wallet:swaps"] = series("swaps");
    d["wallet:usd"] = series("usd");
    d["wallet:share"] = map(wallet.load.map((p) => [p.night, p.value]));
    d["week:load"] = weeklySum(d["wallet:share"]);
    d["week:loadRatio"] = loadRatio(d["week:load"]);
  }
  return d;
}

/**
 * How far the wallet's coins sat below what they cost, night by night
 * (`engine/cost.ts`): `wallet:water` signed (−0.18 is 18% underwater), and
 * `wallet:underwater` as points below cost, 0 when above, for the question.
 * SOL is priced from the market already held; other coins from their daily
 * closes (cached). A coin with no price history is left out.
 */
export async function withUnderwater(d: Data, market: MarketView, wallet: WalletView | null): Promise<Data> {
  if (!wallet?.cost) return d;
  const mints = new Set([
    ...wallet.cost.byNight.flatMap(([, ps]) => ps.filter((p) => p.costed > 0).map((p) => p.mint)),
    ...(wallet.trades ?? []).map((t) => t.mint),
  ]);
  const closes: Record<string, Nightly> = {};
  for (const m of mints) {
    if (m === SOL) closes[m] = map(market.solBars.map((b) => [b.day, b.close]));
    else {
      try {
        closes[m] = await dailyCloses(m);
      } catch {}
    }
  }
  const positions = { now: wallet.cost.now, byNight: new Map(wallet.cost.byNight) };
  const u = underwaterSeries(positions, closes, wallet.first, wallet.last);
  d["wallet:water"] = u;
  d["wallet:underwater"] = map([...u].map(([k, v]) => [k, Math.max(0, -100 * v)]));

  // What the market did to the balance each day, and each coin held now on its own: its daily move,
  // the largest first, for its own question (`coinQuestion`). Only coins with a cost or a trade, so an
  // airdropped token nobody chose does not get a question.
  d["wallet:pnl"] = returnSeries(positions, closes, wallet.first, wallet.last);
  const held = (wallet.holdings ?? [])
    .filter((h) => !isStable(h.mint) && closes[h.mint]?.size)
    .map((h) => ({ mint: h.mint, value: h.amount * lastOf(closes[h.mint]) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, COIN_QUESTIONS);
  for (const { mint } of held) d[`market:coin:${mint}`] = moves(closes[mint]);

  // Each night's trades, scored by their coin's move over the next day: a buy right if it rose, a sell if it fell.
  const offset = -new Date().getTimezoneOffset();
  const trades = wallet.trades ?? [];
  const results = tradeResults({ trades, closes, offsetMinutes: offset, trends: new Map(), horizon: 1 });
  const byNight = new Map<string, number[]>();
  for (const r of results) byNight.set(r.night, [...(byNight.get(r.night) ?? []), r.ret]);
  d["wallet:result"] = map([...byNight].map(([k, xs]) => [k, xs.reduce((a, b) => a + b, 0) / xs.length]));
  // How many were scored and how many were right, so the sport cards (`sport.ts`) can pool nights by trade.
  d["wallet:resultN"] = map([...byNight].map(([k, xs]) => [k, xs.length]));
  d["wallet:resultWon"] = map([...byNight].map(([k, xs]) => [k, xs.filter((x) => x > 0).length]));

  // Pressure each night, from the same series and the journal's realised profit (`engine/pressure.ts`).
  const realised: Nightly = new Map();
  for (const f of ledger(trades, offset).fills) if (f.pnl !== null) realised.set(f.night, (realised.get(f.night) ?? 0) + f.pnl);
  const nights = [...new Set([...(d["health:ln"]?.keys() ?? []), ...(d["wallet:share"]?.keys() ?? [])])].sort();
  const p = pressure(
    { ln: d["health:ln"], rhr: d["health:rhr"], water: u, realised, share: d["wallet:share"], awake: d["wallet:awake"], failed: d["wallet:failed"], dvol: d["market:dvol"], sol: map(market.solBars.map((b) => [b.day, b.close])) },
    nights,
  );
  d["you:pressure"] = map([...p].map(([k, x]) => [k, x.total]));
  return d;
}

const lastOf = (m: Nightly) => m.get([...m.keys()].sort().at(-1)!) ?? 0;

/** Each day's close against the day before's, in percent. */
function moves(closes: Nightly): Nightly {
  const out: Nightly = new Map();
  const days = [...closes.keys()].sort();
  for (let i = 1; i < days.length; i++) {
    const a = closes.get(days[i - 1])!;
    if (a > 0) out.set(days[i], 100 * (closes.get(days[i])! / a - 1));
  }
  return out;
}

/** The registry, and one question for each coin the data carries a move for (`withUnderwater`), named by its symbol. */
export async function questionsFor(data: Data): Promise<Hypothesis[]> {
  const mints = Object.keys(data)
    .filter((k) => k.startsWith("market:coin:"))
    .map((k) => k.slice("market:coin:".length));
  const symbols = await Promise.all(mints.map((m) => coinInfo(m).then((c) => c.symbol, () => `${m.slice(0, 4)}…`)));
  return [...HYPOTHESES, ...mints.map((m, i) => coinQuestion(m, symbols[i], mints.length))];
}

/**
 * Every question, one per tick, so the screen can show progress: each runs
 * a 2,000-draw block bootstrap, and fourteen of them take a few seconds here.
 */
export async function runExposure(
  data: Data,
  questions: Hypothesis[],
  onEach?: (done: number, total: number) => void,
  alive: () => boolean = () => true,
): Promise<Answer[]> {
  const out: Answer[] = [];
  for (const h of questions) {
    // Newer data started a fresh run: stop this one rather than finish work nobody will see.
    if (!alive()) break;
    out.push({ h, r: test(h, data) });
    onEach?.(out.length, questions.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** Plain words for which piece of data a question is still missing. */
export function missingWord(key: string): string {
  if (key === "you:pressure") return "your HRV";
  if (key === "wallet:result") return "your trades";
  if (key.startsWith("wallet:") || key === "week:load" || key === "week:loadRatio") return "your wallet";
  if (key.includes("strain")) return "daily activity";
  if (key.startsWith("health:") || key === "week:cv" || key === "week:baseline") return "your HRV";
  if (key.includes("expected") || key.includes("realised")) return "the volatility race";
  return "market data";
}

/**
 * A short fingerprint of the data the questions are asked of: each series'
 * size, last date and sum. The same history gives the same answers, so the
 * answers are kept against it (`data.tsx`) and only asked again when it moves.
 */
export function fingerprint(d: Data): string {
  const text = Object.keys(d)
    .sort()
    .map((k) => {
      const m = d[k as keyof Data]!;
      let sum = 0;
      let lastKey = "";
      for (const [key, v] of m) {
        sum += v;
        if (key > lastKey) lastKey = key;
      }
      return `${k}:${m.size}:${lastKey}:${sum.toFixed(4)}`;
    })
    .join("|");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
