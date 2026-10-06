import type { Marker } from "./prochart";
import type { Trade } from "./walletview";

/**
 * The reader's trades of one coin, placed on a chart's time axis: each in the
 * bar it happened during. `t` is each bar's open time, oldest first; a trade
 * before the first bar or after the last bar's close is left off.
 */
export function markersFor(t: number[], barMs: number, trades: Trade[] | undefined, mint: string): Marker[] {
  if (!t.length || !trades?.length) return [];
  const out: Marker[] = [];
  for (const tr of trades) {
    if (tr.mint !== mint || tr.t < t[0] || tr.t >= t[t.length - 1] + barMs) continue;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid] <= tr.t) lo = mid;
      else hi = mid - 1;
    }
    out.push({ i: lo, side: tr.side });
  }
  return out;
}

export const BAR_MS: Record<string, number> = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
};
