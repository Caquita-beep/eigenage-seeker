import type { Cycle, Member, Page, Recovery, Sleep } from "./types";

/**
 * Reading a member's history from WHOOP, a page at a time.
 *
 * Everything here goes through a `Fetcher`: one function that answers a
 * collection endpoint with one page. `apiFetcher` is WHOOP itself; the
 * synthetic member (`synthetic.ts`) is another, serving the same pages from
 * generated records. So the paging, the window and the mapping that runs
 * against the synthetic member today are the code that will run against the
 * first real account — only the fetcher changes.
 *
 * OAuth — getting and refreshing the token `apiFetcher` takes — is not built
 * yet. It needs a registered WHOOP developer app, and that needs a member.
 */

export const WHOOP_API = "https://api.prod.whoop.com/developer";

export type Collection = "v2/recovery" | "v2/activity/sleep" | "v2/cycle";

export interface Query {
  /** ISO date-times. WHOOP: start inclusive; end exclusive, defaulting to now. */
  start: string;
  end: string;
  limit: number;
  nextToken?: string;
}

export type Fetcher = (collection: Collection, query: Query) => Promise<Page<unknown>>;

/** WHOOP's ceiling for `limit`, on all three collections. */
export const PAGE_LIMIT = 25;

/**
 * A guard, not a budget: a year of nightly records is ~15 pages per
 * collection. A token that never runs out is a bug to stop on, not to follow.
 */
const MAX_PAGES = 400;

export class WhoopError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function apiFetcher(accessToken: string, f: typeof fetch = fetch): Fetcher {
  return async (collection, q) => {
    const url = new URL(`${WHOOP_API}/${collection}`);
    url.searchParams.set("start", q.start);
    url.searchParams.set("end", q.end);
    url.searchParams.set("limit", String(q.limit));
    if (q.nextToken) url.searchParams.set("nextToken", q.nextToken);
    const res = await f(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new WhoopError(`WHOOP ${collection}: HTTP ${res.status}`, res.status);
    return (await res.json()) as Page<unknown>;
  };
}

/** Every record in the window, following `next_token` to the last page. */
export async function collect<T>(
  fetcher: Fetcher,
  collection: Collection,
  window: { start: string; end: string },
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const p = await fetcher(collection, { ...window, limit: PAGE_LIMIT, nextToken });
    out.push(...(p.records as T[]));
    if (!p.next_token) return out;
    if (seen.has(p.next_token)) throw new WhoopError(`WHOOP ${collection}: next_token repeated`);
    seen.add(p.next_token);
    nextToken = p.next_token;
  }
  throw new WhoopError(`WHOOP ${collection}: more than ${MAX_PAGES} pages`);
}

/**
 * The member's history over the window, all three collections.
 *
 * Sleeps are fetched from a day before the window so the first recovery in it
 * can find the sleep it names: a recovery logged on the window's first morning
 * was measured from a sleep that began the evening before.
 */
export async function backfill(fetcher: Fetcher, window: { start: string; end: string }): Promise<Member> {
  const early = new Date(Date.parse(window.start) - 86_400_000).toISOString();
  const [recoveries, sleeps, cycles] = await Promise.all([
    collect<Recovery>(fetcher, "v2/recovery", window),
    collect<Sleep>(fetcher, "v2/activity/sleep", { start: early, end: window.end }),
    collect<Cycle>(fetcher, "v2/cycle", window),
  ]);
  return { recoveries, sleeps, cycles };
}
