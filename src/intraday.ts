/**
 * Intraday series for the charts, fetched on demand — never part of the
 * market view the rest of the app reads, which stays daily.
 *
 * DVOL hourly: Deribit serves its volatility index at hourly resolution,
 * keyless; 30 days is 720 points, one call, no continuation.
 */

const cache = new Map<string, { at: number; points: [number, number][] }>();

export async function fetchDvolHourly(days = 30): Promise<[number, number][]> {
  const hit = cache.get(`dvol:${days}`);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.points;
  const end = Date.now();
  const url =
    "https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC" +
    `&start_timestamp=${end - days * 86_400_000}&end_timestamp=${end}&resolution=3600`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`DVOL hourly ${res.status}`);
  const json = (await res.json()) as { result: { data: [number, number, number, number, number][] } };
  const points = json.result.data.map(([t, , , , close]) => [t, close] as [number, number]);
  cache.set(`dvol:${days}`, { at: Date.now(), points });
  return points;
}
