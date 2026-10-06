import { useMemo } from "react";
import { useExposure, useMarket } from "./data";
import type { Nightly } from "./engine/nights";
import { pressure, type PressureDay, type PressureKey } from "./engine/pressure";
import type { Tone } from "./insight";
import { useJournal } from "./journalread";

/**
 * Pressure on the phone (`engine/pressure.ts`): the series the questions are
 * asked of, plus each night's realised profit from the journal. Read for the
 * last 90 nights, so the detail screen can draw it and Today can show the
 * latest.
 */

export const LEVEL: Record<PressureDay["level"], { word: string; tone: Tone }> = {
  low: { word: "Low", tone: "good" },
  rising: { word: "Rising", tone: "watch" },
  high: { word: "High", tone: "bad" },
};

const pct = (x: number) => `${Math.round(100 * x)}%`;

/** Each signal's name and its value in plain units. */
export const SIGNAL: Record<PressureKey, { part: "body" | "positions" | "market"; name: string; value: (v: number) => string }> = {
  hrv: { part: "body", name: "HRV below normal", value: (v) => `${v.toFixed(1)} SD` },
  cv: { part: "body", name: "HRV swings", value: (v) => `${v.toFixed(1)} SD` },
  rhr: { part: "body", name: "Resting HR above normal", value: (v) => `${v.toFixed(1)} SD` },
  underwater: { part: "positions", name: "Underwater vs cost", value: (v) => pct(v) },
  givenBack: { part: "positions", name: "Given back from 30-day high", value: (v) => pct(v) },
  losses: { part: "positions", name: "Realised losses, 7 days", value: (v) => `$${Math.round(v).toLocaleString()}` },
  pace: { part: "positions", name: "Pace above usual", value: (v) => `${(1 + v).toFixed(1)}×` },
  lateNight: { part: "positions", name: "On-chain past midnight", value: (v) => (v > 0 ? "yes" : "no") },
  failed: { part: "positions", name: "Failed transactions", value: (v) => `${v}` },
  dvol: { part: "market", name: "Expected volatility (DVOL)", value: (v) => v.toFixed(0) },
  swings: { part: "market", name: "SOL's daily swings", value: (v) => `${(100 * v).toFixed(1)}%` },
};

export function usePressure(): { days: PressureDay[]; now: PressureDay | null } {
  const { data } = useExposure();
  const { view: market } = useMarket();
  const { journal: j } = useJournal();

  return useMemo(() => {
    if (!data) return { days: [], now: null };
    const realised: Nightly | undefined = j
      ? j.ledger.fills.reduce((m, f) => (f.pnl !== null ? m.set(f.night, (m.get(f.night) ?? 0) + f.pnl) : m), new Map<string, number>())
      : undefined;
    const keys = [...new Set([...(data["health:ln"]?.keys() ?? []), ...(data["wallet:share"]?.keys() ?? [])])].sort();
    const nights = keys.slice(-90);
    const p = pressure(
      {
        ln: data["health:ln"],
        rhr: data["health:rhr"],
        water: data["wallet:water"],
        realised,
        share: data["wallet:share"],
        awake: data["wallet:awake"],
        failed: data["wallet:failed"],
        dvol: data["market:dvol"],
        sol: market?.solBars.length ? new Map(market.solBars.map((b) => [b.day, b.close])) : undefined,
      },
      nights,
    );
    const days = nights.map((n) => p.get(n)).filter((d): d is PressureDay => d !== undefined);
    return { days, now: days.at(-1) ?? null };
  }, [data, market, j]);
}
