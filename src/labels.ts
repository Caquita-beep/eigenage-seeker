import { DOWN, UP } from "./indicators";
import type { MarketView } from "./market";

export const fngWord = (v: number) =>
  v < 25 ? "Extreme fear" : v < 45 ? "Fear" : v <= 55 ? "Neutral" : v <= 75 ? "Greed" : "Extreme greed";

export const fngColor = (v: number) => (v < 25 ? DOWN : v < 45 ? "#C9733F" : v <= 55 ? "#5E6673" : v <= 75 ? "#3E9E6E" : UP);

/** Where a value sits against its own 60-day normal, as a pill. */
export const bandPill = {
  above: { text: "Above normal", tint: "#3B5BA9" },
  within: { text: "Normal", tint: "#3A3F48" },
  below: { text: "Below normal", tint: "#9C3B45" },
} as const;

/** DVOL minus BTC realised volatility, on the days both exist. */
export function premiumSeries(v: Pick<MarketView, "dvolSeries" | "btcRealisedSeries">): [string, number][] {
  const rv = new Map(v.btcRealisedSeries);
  return v.dvolSeries.filter((d) => rv.has(d.day)).map((d) => [d.day, d.value - rv.get(d.day)!]);
}

export const tail = <T,>(xs: T[], n = 90) => xs.slice(Math.max(0, xs.length - n));
