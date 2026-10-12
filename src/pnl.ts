import { ledger, type JournalTrade } from "./engine/journal";
import { addDays, type Nightly } from "./engine/nights";
import { UP, type Values } from "./indicators";
import type { Pane } from "./prochart";

/**
 * Realised P&L, day by day: what each day's sells made over what the coins
 * cost, first in, first out (`engine/journal.ts`), on the journal's nights
 * (05:00 to 05:00, so a 2 a.m. sell counts with the evening before). The
 * same figure as the journal's and the 90-day card's.
 *
 * It is laid under every chart that takes indicators, and asked of in the
 * correlations (`drivers.ts`, as `wallet:realised`), so the money sits on
 * the same days as the body and the market everywhere.
 */

/** Only days with a sell that matched earlier buys have one; a day without is no P&L, not zero. */
export function realisedByNight(trades: JournalTrade[], offsetMinutes: number): Nightly {
  const out: Nightly = new Map();
  for (const f of ledger(trades, offsetMinutes).fills) if (f.pnl !== null) out.set(f.night, (out.get(f.night) ?? 0) + f.pnl);
  return out;
}

/** The tab that lays P&L under a chart. */
export const PNL_TAB = { key: "pnl", label: "P&L" };

export const usd = (v: number) => `${v < -0.5 ? "−" : v > 0.5 ? "+" : ""}$${Math.round(Math.abs(v)).toLocaleString()}`;

/**
 * Realised P&L as a pane on `days`, green above zero and red below, with the
 * running total from the first day as a hairline over the bars, on its own
 * scale so it does not flatten them. `span` sums that many days from each (7
 * under a weekly candle). A day without a sell is empty.
 */
export function pnlPane(days: string[], realised: Nightly, height: number, span = 1): Pane {
  const values: Values = days.map((d) => {
    let sum = 0;
    let any = false;
    for (let k = 0; k < span; k++) {
      const v = realised.get(span === 1 ? d : addDays(d, k));
      if (v !== undefined) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  });
  let run = 0;
  const total: Values = values.map((v) => (run += v ?? 0));
  return {
    key: "pnl",
    title: "Realised P&L",
    height,
    lines: [
      { key: "pnl", label: span === 1 ? "Day" : "Week", values, color: UP, kind: "bars", signed: true, total: true },
      { key: "total", label: "Total", values: total, color: "#B7BDC6", width: 0.8, ownScale: true, last: true },
    ],
    guides: [0],
    format: usd,
  };
}
