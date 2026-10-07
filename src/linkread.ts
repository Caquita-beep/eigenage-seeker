import { say } from "./answers";
import { isCoinQuestion, type Hypothesis, type SeriesKey } from "./engine/hypotheses";
import { missingWord, type Answer } from "./exposure";
import type { Tone } from "./insight";

/**
 * The questions on the Insights tab in plain words: what the reader's own
 * history says about each link between the market, their trading and their
 * body. Only the engine decides whether a link is there (`engine/hypotheses.ts`);
 * this file only says it.
 */

export type LinkStatus = "found" | "partial" | "none" | "two-way" | "learning" | "missing";

export interface LinkRead {
  id: string;
  title: string;
  status: LinkStatus;
  /** One or two words for the chip. */
  word: string;
  tone: Tone;
  line: string;
  /** The statistics, for the detail screen. */
  detail?: string;
}

/** The links that lead the tab, in order: the three the app was built on, then the reader's position. */
export const LINKS: { id: string; title: string }[] = [
  { id: "readiness-trading", title: "Your body → your trading" },
  { id: "fear-or-turbulence", title: "Market fear → your body" },
  { id: "trading-load", title: "Your trading → your body" },
  { id: "underwater-hrv", title: "Underwater → your body" },
  { id: "balance-hrv", title: "Your balance → your body" },
  { id: "pressure-results", title: "Pressure → your results" },
];

/** A link's title: the leading links' own, a coin's from its symbol, else the question. */
export const linkTitle = (h: Hypothesis) =>
  LINKS.find((l) => l.id === h.id)?.title ?? (isCoinQuestion(h.id) ? `${h.subject} → your body` : h.question);

const pctHrv = (e: number) => `${Math.abs((Math.exp(e) - 1) * 100).toFixed(0)}%`;

const NONE: Record<string, string> = {
  "readiness-trading": "You put about the same at stake whether your body started the day below its normal or not.",
  "fear-or-turbulence": "How steady your HRV is does not follow the market's volatility.",
  "trading-load": "Your heaviest trading weeks are not followed by a less steady body.",
  "underwater-hrv": "Your HRV is about the same after days your coins end below what they cost.",
  "balance-hrv": "Your HRV is about the same after days your coins gain value as after days they lose it.",
  "pressure-results": "Your trades do about as well whatever your Pressure that morning.",
};

/** "Your wallet" in the app's sense: the SOL and stablecoins a swap can draw on. */
const WALLET = "your wallet (SOL and stablecoins)";

function found(h: Hypothesis, e: number, sd: Sides | null = null): string {
  switch (h.id) {
    case "readiness-trading":
      return sd
        ? `After a below-normal morning you swap ${sd.yes.value} of ${WALLET} in a day, on average. After a normal morning, ${sd.no.value}.`
        : `After a below-normal morning you swap ${e > 0 ? "more" : "less"} of ${WALLET}: ${Math.round(Math.abs(e) * 100)} percentage points of it.`;
    case "trading-load":
      return e > 0 ? "After your heaviest trading weeks, your HRV is less steady the week after." : "After your heaviest trading weeks, your HRV is steadier.";
    case "underwater-hrv":
      return sd
        ? `After days your coins end 5% or more below what they cost, your HRV the next morning averages ${sd.yes.value}, against ${sd.no.value} after other days.`
        : `After a day your coins end 5% or more below what they cost, your HRV is ${pctHrv(e)} ${e < 0 ? "lower" : "higher"} the next morning, beyond what the market's day explains.`;
    case "balance-hrv":
      return sd
        ? `After days your coins gained value, your HRV the next morning averages ${sd.yes.value}; after days they lost, ${sd.no.value}.`
        : `After a day your coins gain 5%, your HRV is ${pctHrv(e)} ${e < 0 ? "lower" : "higher"} the next morning, beyond what the market's day explains.`;
    case "pressure-results":
      return sd
        ? `On high-Pressure mornings your trades average ${sd.yes.value} over the next day; on other mornings, ${sd.no.value}.`
        : `When your Pressure is 50 points higher, your trades do ${Math.abs(100 * e).toFixed(1)}% ${e < 0 ? "worse" : "better"} over the next day.`;
    case "awake-hrv":
      return `After nights you are on-chain past midnight, your HRV is ${pctHrv(e)} ${e < 0 ? "lower" : "higher"} the next morning.`;
    case "surprise-hrv":
      return `After a surprising SOL day, your HRV is ${pctHrv(e)} ${e < 0 ? "lower" : "higher"} the next morning.`;
    case "below-late":
      return "On days your body started below its normal, you were on-chain later at night.";
    case "below-count":
      return "On days your body started below its normal, you made more swaps.";
    case "below-failed":
      return "On days your body started below its normal, more of your transactions failed.";
    case "strained-trading":
      return sd
        ? `On days after a strained morning you swap ${sd.yes.value} of ${WALLET}, against ${sd.no.value} otherwise.`
        : `On days after a strained morning you swap ${e > 0 ? "more" : "less"} of ${WALLET}.`;
    case "greed-share":
      return e > 0 ? "On greedy days you put more of your wallet at stake." : "On greedy days you put less of your wallet at stake.";
    default:
      if (isCoinQuestion(h.id)) {
        return sd
          ? `After days ${h.subject} rose, your HRV the next morning averages ${sd.yes.value}; after days it fell, ${sd.no.value}.`
          : `After a day ${h.subject} rises 5%, your HRV is ${pctHrv(e)} ${e < 0 ? "lower" : "higher"} the next morning, beyond what the market's day explains.`;
      }
      return h.question;
  }
}

export function readLink(a: Answer, title?: string, data?: Partial<Record<SeriesKey, Map<string, number>>> | null): LinkRead {
  const { h, r } = a;
  const base = { id: h.id, title: title ?? linkTitle(h), detail: say(a).detail };
  const unit = h.grain === "week" ? "weeks" : "nights";
  switch (r.status) {
    case "missing":
      return { ...base, status: "missing", word: "Needs data", tone: "neutral", line: `Needs ${[...new Set(r.series.map(missingWord))].join(" and ")}.` };
    case "collecting":
      return { ...base, status: "learning", word: "Learning", tone: "neutral", line: `Learning from your history: ${r.have} of ${r.need} ${unit} so far.` };
    case "no-contrast":
      return { ...base, status: "learning", word: "Learning", tone: "neutral", line: `Not enough contrast yet: ${r.exposed} of ${r.n} ${unit} on one side, and it needs 8 on each.` };
    case "race":
      if (r.verdict === "first") return { ...base, status: "found", word: "Found", tone: "watch", line: "Your HRV swings more when the market prices in fear, more than when prices actually move." };
      if (r.verdict === "second") return { ...base, status: "found", word: "Found", tone: "watch", line: "Your HRV swings with the market's actual moves, more than with its fear." };
      if (r.verdict === "unclear")
        return { ...base, status: "partial", word: "Linked", tone: "watch", line: "Your HRV swings more in volatile weeks. Whether it is the fear or the moves themselves, your data cannot tell yet." };
      return { ...base, status: "none", word: "No link", tone: "neutral", line: NONE[h.id] ?? "No clear link." };
    case "result":
      if (!r.detected && isCoinQuestion(h.id))
        return { ...base, status: "none", word: "No link", tone: "neutral", line: `Your HRV is about the same after days ${h.subject} rises as after days it falls.` };
      if (r.detected && r.suspect)
        return { ...base, status: "two-way", word: "Two-way", tone: "neutral", line: "Linked both ways, so something else probably drives both. Not counted as a finding." };
      if (!r.detected) return { ...base, status: "none", word: "No link", tone: "neutral", line: NONE[h.id] ?? "No clear link." };
      return { ...base, status: "found", word: "Found", tone: "watch", line: found(h, r.effect, data ? sides(h, data) : null) };
  }
}

/** Exploratory questions that came out clearly, beyond the four that lead. Worded as hints, never as findings. */
export function alsoSeen(answers: Answer[], data?: Partial<Record<SeriesKey, Map<string, number>>> | null): LinkRead[] {
  return answers
    .filter(
      (a) => a.h.tier === "exploratory" && !LINKS.some((l) => l.id === a.h.id) && !isCoinQuestion(a.h.id) && a.r.status === "result" && a.r.detected && !a.r.suspect,
    )
    .map((a) => ({ ...readLink(a, a.h.question, data), word: "Hint", line: found(a.h, (a.r as { effect: number }).effect, data ? sides(a.h, data) : null) }));
}

/** The two series that show a link: the body's (drawn on top) and what it is tested against. */
export const EVIDENCE: Record<string, { body: SeriesKey; bodyLabel: string; other: SeriesKey; otherLabel: string; weekly: boolean }> = {
  "fear-or-turbulence": { body: "week:cv", bodyLabel: "HRV CV, weekly (how unsteady)", other: "week:expected", otherLabel: "Expected volatility, weekly", weekly: true },
  "readiness-trading": { body: "health:ln", bodyLabel: "HRV (ln rMSSD), daily", other: "wallet:share", otherLabel: "Share of wallet at stake, the day after", weekly: false },
  "trading-load": { body: "week:cv", bodyLabel: "HRV CV, weekly", other: "week:loadRatio", otherLabel: "Trading load vs your usual, weekly", weekly: true },
  "underwater-hrv": { body: "health:ln", bodyLabel: "HRV the next morning (ln rMSSD)", other: "wallet:water", otherLabel: "Coins vs cost, at day's close", weekly: false },
  "balance-hrv": { body: "health:ln", bodyLabel: "HRV the next morning (ln rMSSD)", other: "wallet:pnl", otherLabel: "Your coins' day, from prices", weekly: false },
  "pressure-results": { body: "you:pressure", bodyLabel: "Pressure, each morning", other: "wallet:result", otherLabel: "Your trades' result over the next day", weekly: false },
};

export function evidenceFor(h: Hypothesis): (typeof EVIDENCE)[string] | undefined {
  if (EVIDENCE[h.id]) return EVIDENCE[h.id];
  if (isCoinQuestion(h.id)) return { body: "health:ln", bodyLabel: "HRV the next morning (ln rMSSD)", other: h.exposure, otherLabel: `${h.subject}'s day`, weekly: false };
  return undefined;
}

/**
 * For a yes-or-no question, the outcome's plain average on each side — what a
 * reader can see at a glance. The test itself also holds the market and the
 * weekday fixed; these two numbers do not, so they illustrate the finding and
 * the verdict stays the test's.
 */
export interface Sides {
  no: { label: string; value: string; raw: number };
  yes: { label: string; value: string; raw: number };
  what: string;
  /** A few words for a one-line display. */
  short: string;
}

/** `bar` turns the outcome into the number the bar's length is drawn from (HRV is kept in ln, shown in ms). */
/** `cut` splits a question measured on a scale (rather than yes or no) into two sides for display. */
const SIDES: Record<string, { no: string; yes: string; what: string; short?: string; cut?: number; format: (v: number) => string; bar?: (v: number) => number }> = {
  "pressure-results": {
    no: "Other mornings",
    yes: "High-Pressure mornings",
    what: "result a trade over the next day",
    short: "a trade, next day",
    cut: 60,
    format: (v) => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1)}%`,
    bar: (v) => Math.abs(v),
  },
  "readiness-trading": { no: "After a normal morning", yes: "After a below-normal morning", what: "share of your wallet (SOL and stablecoins) swapped in a day", short: "of wallet swapped a day", format: (v) => `${(100 * v).toFixed(0)}%` },
  "strained-trading": { no: "After other mornings", yes: "After a strained morning", what: "share of your wallet (SOL and stablecoins) swapped in a day", format: (v) => `${(100 * v).toFixed(0)}%` },
  "underwater-hrv": { no: "After other days", yes: "After a day 5% or more underwater", what: "HRV the next morning", short: "HRV next morning", format: (v) => `${Math.round(Math.exp(v))} ms`, bar: Math.exp },
  "balance-hrv": { no: "After a down day", yes: "After an up day", what: "HRV the next morning", short: "next-morning HRV, up vs down days", cut: 0, format: (v) => `${Math.round(Math.exp(v))} ms`, bar: Math.exp },
  "awake-hrv": { no: "After early nights", yes: "After nights on-chain past midnight", what: "HRV the next morning", format: (v) => `${Math.round(Math.exp(v))} ms`, bar: Math.exp },
  "below-count": { no: "After a normal morning", yes: "After a below-normal morning", what: "swaps a day", format: (v) => v.toFixed(1) },
  "below-late": { no: "After a normal morning", yes: "After a below-normal morning", what: "transactions after midnight", format: (v) => v.toFixed(1) },
};

export function sides(h: Hypothesis, data: Partial<Record<SeriesKey, Map<string, number>>>): Sides | null {
  const f = SIDES[h.id] ?? (isCoinQuestion(h.id) ? SIDES["balance-hrv"] : undefined);
  const x = data[h.exposure];
  const y = data[h.outcome];
  const cut = h.threshold ?? f?.cut;
  if (!f || cut === undefined || !x || !y) return null;
  const step = h.grain === "week" ? 7 : 1;
  const yes: number[] = [];
  const no: number[] = [];
  for (const [key, v] of y) {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - h.lag * step);
    const xv = x.get(d.toISOString().slice(0, 10));
    if (xv === undefined) continue;
    (xv >= cut ? yes : no).push(v);
  }
  if (yes.length < 3 || no.length < 3) return null;
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const a = mean(no);
  const b = mean(yes);
  const bar = f.bar ?? ((v: number) => v);
  return { no: { label: f.no, value: f.format(a), raw: bar(a) }, yes: { label: f.yes, value: f.format(b), raw: bar(b) }, what: f.what, short: f.short ?? f.what };
}

export interface CoinLink {
  id: string;
  mint: string;
  symbol: string;
  read: LinkRead;
  sd: Sides | null;
  /** The test's effect when it ran: the next morning's HRV per 5% the coin rose, on the log scale. */
  effect: number | null;
}

/**
 * Each coin's question, ordered by what the reader asked first: which coin's
 * rises go with their better mornings. Found links first, then by effect.
 */
export function coinLinks(answers: Answer[], data?: Partial<Record<SeriesKey, Map<string, number>>> | null): CoinLink[] {
  return answers
    .filter((a) => isCoinQuestion(a.h.id))
    .map((a) => ({
      id: a.h.id,
      mint: a.h.exposure.slice("market:coin:".length),
      symbol: a.h.subject ?? "",
      read: readLink(a, undefined, data),
      sd: data ? sides(a.h, data) : null,
      effect: a.r.status === "result" ? a.r.effect : null,
    }))
    .sort((x, y) => Number(y.read.status === "found") - Number(x.read.status === "found") || (y.effect ?? -Infinity) - (x.effect ?? -Infinity));
}
