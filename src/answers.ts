import type { Hypothesis, Result } from "./engine/hypotheses";
import type { Answer } from "./exposure";
import { missingWord } from "./exposure";
import { color } from "./theme";

/**
 * Results in words. The engine reports effects in the outcome's own units
 * (ln HRV, CV percent, share of the wallet); here they become things a
 * person can read, and a result that is not a finding is never worded as one.
 */

export const SHORT: Record<string, string> = {
  "fear-or-turbulence": "Fear or turbulence",
  "readiness-trading": "Your state, then your trading",
  "trading-load": "Your trading, then your state",
  "premium-cv": "Fear ahead of reality",
  "greed-cv": "Greed and your stability",
  "greed-share": "Greed and your stake",
  "fear-baseline": "Fear and your baseline",
  "strained-trading": "Strained mornings",
  "below-count": "Low mornings, more swaps",
  "below-failed": "Low mornings, failed transactions",
  "below-late": "Low mornings, late nights",
  "underwater-hrv": "Underwater, next morning",
  "pressure-results": "Pressure, then your results",
  "surprise-hrv": "A surprising day, next morning",
  "awake-hrv": "On-chain past midnight, next morning",
  "surprise-awake": "A surprising day, a late night",
};

function per(h: Hypothesis): string {
  if (h.threshold !== undefined) return "";
  const ex = h.exposure;
  if (ex.includes("dvol") || ex.includes("vrp") || ex.includes("expected")) return ` for every ${h.per} points of expected volatility (DVOL, in % a year)`;
  if (ex.includes("fng")) return ` for every ${h.per} points on the 0–100 Fear & Greed index`;
  if (ex.includes("shock")) return ` per ${h.per}σ move`;
  if (ex.includes("loadRatio")) return " per week at twice your usual load";
  if (ex === "you:pressure") return ` a trade over the next day, for every ${h.per} points of Pressure`;
  return "";
}

/** An effect in the outcome's units, signed. */
function amount(h: Hypothesis, e: number): string {
  const o = h.outcome;
  const sign = e > 0 ? "+" : "−";
  const a = Math.abs(e);
  if (o === "health:ln" || o === "week:baseline") return `${e > 0 ? "+" : "−"}${Math.abs((Math.exp(e) - 1) * 100).toFixed(1)}% HRV`;
  if (o === "week:cv") return `${sign}${a.toFixed(2)} percentage points of HRV variation (CV)`;
  if (o === "wallet:result") return `${sign}${(a * 100).toFixed(2)}%`;
  if (o === "wallet:share") return `${sign}${(a * 100).toFixed(1)} percentage points of your wallet (SOL and stablecoins) swapped in a day`;
  if (o === "wallet:awake") return `${sign}${(a * 100).toFixed(0)} percentage points more likely`;
  if (o === "wallet:swaps") return `${sign}${a.toFixed(2)} swaps`;
  if (o === "wallet:failed") return `${sign}${a.toFixed(2)} failed`;
  if (o === "wallet:late") return `${sign}${a.toFixed(2)} late transactions`;
  return `${sign}${a.toFixed(3)}`;
}

export interface Said {
  status: string;
  tint: string;
  detail?: string;
}

export function say({ h, r }: Answer): Said {
  const unit = h.grain === "week" ? "weeks" : "nights";
  switch (r.status) {
    case "missing":
      return { status: `Needs ${[...new Set(r.series.map(missingWord))].join(" and ")}`, tint: color.faint };
    case "collecting":
      return { status: `${r.have} of ${r.need} ${unit}`, tint: color.muted, detail: `Asked once there are ${r.need} ${unit} with every piece present.` };
    case "no-contrast":
      return {
        status: "Not enough contrast",
        tint: color.muted,
        detail: `${r.exposed} of ${r.n} ${unit} on one side. The question needs at least 8 on each.`,
      };
    case "race": {
      const pct = Math.round(r.confidence * 1000) / 10;
      const words = {
        first: "Follows the fear",
        second: "Follows what happened",
        unclear: "Follows volatility; which kind is unclear",
        neither: "Follows neither",
      } as const;
      const f = r.race.first;
      const s = r.race.second;
      return {
        status: words[r.verdict],
        tint: r.verdict === "neither" ? color.muted : color.body,
        detail:
          `Expected volatility ${amount(h, f.effect)}${per(h)} (${pct}% interval ${amount(h, f.interval[0])} to ${amount(h, f.interval[1])}). ` +
          `Realised ${amount(h, s.effect)}${per(h)}. ${r.n} ${unit}. The two moved together at r = ${r.race.overlap.toFixed(2)}` +
          (r.race.overlap > 0.8 ? ", which leaves little to tell them apart." : "."),
      };
    }
    case "result": {
      const pct = Math.round(r.confidence * 1000) / 10;
      const range = `${pct}% interval ${amount(h, r.interval[0])} to ${amount(h, r.interval[1])}, ${r.n} ${unit}`;
      if (!r.detected) return { status: "No link found", tint: color.muted, detail: `${amount(h, r.effect)}${per(h)}; ${range}. The interval includes zero.` };
      if (r.suspect) {
        return {
          status: "Linked both ways",
          tint: color.wallet,
          detail: `${amount(h, r.effect)}${per(h)}; ${range}. The reverse direction came out just as clearly, so something else probably drives both. Not shown as a finding.`,
        };
      }
      return { status: `${amount(h, r.effect)}${per(h)}`, tint: color.body, detail: `${range}. The interval excludes zero.` };
    }
  }
}
