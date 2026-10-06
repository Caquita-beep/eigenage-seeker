import { addDays } from "./engine/nights";
import type { Check, Glance } from "./glance";
import type { WalletView } from "./wallet";

/**
 * The Wallet tab at a glance: is this week's trading heavier, usual or
 * lighter than the reader's own, and three checks.
 *
 * The word is one thing only: this week's trading load — the share of liquid
 * holdings swapped over the last 7 nights — against the mean of the four weeks
 * before it. That is the engine's own load ratio (`weeks.ts`, `loadRatio`),
 * the uncoupled acute:chronic form: the week is not inside its own baseline.
 * The 60-night band the body uses does not suit trading, which is a few big
 * nights among many quiet ones; its range came out as "13% to 106% a week" and
 * called nearly every week usual. Late nights and failed transactions are
 * checks beside it, never votes.
 */

/**
 * Half again more than usual is heavier; two thirds of usual or less is
 * lighter. A product choice for a word a person can act on, not a published
 * threshold.
 */
const HEAVIER = 1.5;
const LIGHTER = 2 / 3;

export interface TradingWeek {
  /** Share of liquid holdings moved over the last 7 nights. */
  moved: number;
  /** Mean of the same over each of the four weeks before. Null without four full weeks. */
  usual: number | null;
  ratio: number | null;
  weight: "heavier" | "usual" | "lighter" | null;
}

export function tradingWeek(v: WalletView): TradingWeek {
  const byNight = new Map(v.load.map((p) => [p.night, p]));
  const nights = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => byNight.get(addDays(v.last, -from - i))).filter((p) => p !== undefined);
  const moved = nights(0, 7).reduce((s, p) => s + p.value, 0);
  const prior = [1, 2, 3, 4].map((k) => nights(7 * k, 7));
  const usual = prior.every((w) => w.length === 7) ? prior.reduce((s, w) => s + w.reduce((t, p) => t + p.value, 0), 0) / 4 : null;
  const ratio = usual !== null && usual > 0 ? moved / usual : null;
  const weight = ratio === null ? null : ratio >= HEAVIER ? "heavier" : ratio <= LIGHTER ? "lighter" : "usual";
  return { moved, usual, ratio, weight };
}

export function walletGlance(v: WalletView): Glance {
  const byNight = new Map(v.load.map((p) => [p.night, p]));
  const nights = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => byNight.get(addDays(v.last, -from - i))).filter((p) => p !== undefined);
  const week = nights(0, 7);
  const before = nights(7, 28);
  const thisWeek = (k: "awake" | "failed") => week.reduce((s, p) => s + p[k], 0);
  const perWeekBefore = (k: "awake" | "failed") => (before.length ? (before.reduce((s, p) => s + p[k], 0) / before.length) * 7 : 0);
  /** Two or more this week, and more than the four weeks before. */
  const up = (k: "awake" | "failed") => thisWeek(k) >= 2 && thisWeek(k) > perWeekBefore(k) + 0.5;

  const tw = tradingWeek(v);
  const checks: Check[] = [];
  if (tw.weight) {
    checks.push({
      id: "size",
      label: "Size",
      word: tw.weight === "heavier" ? "big" : tw.weight === "lighter" ? "small" : "usual",
      tone: tw.weight === "heavier" ? "watch" : "good",
      route: "/chart/load",
    });
  }
  checks.push({
    id: "nights",
    label: "Nights",
    word: up("awake") ? "late" : "ok",
    tone: up("awake") ? "watch" : "good",
    route: "/chart/nights",
  });
  checks.push({
    id: "fails",
    label: "Fails",
    word: up("failed") ? "many" : "ok",
    tone: up("failed") ? "watch" : "good",
    route: "/chart/load?sub=count",
  });

  switch (tw.weight) {
    case "heavier":
      return { word: "Heavier", tone: "watch", advice: "Ease off.", checks };
    case "lighter":
      return { word: "Lighter", tone: "good", advice: "Quiet week.", checks };
    case "usual":
      return { word: "Usual", tone: "good", advice: "Steady pace.", checks };
    default:
      return { word: "Learning", tone: "neutral", advice: "Needs 5 weeks of trading.", checks };
  }
}
