import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The wallets the reader has added, and which one the app reads.
 *
 * The app only reads a wallet's history, by its address, from the chain
 * (`wallet.ts`), so switching needs no wallet app: only adding one goes
 * through Mobile Wallet Adapter, to learn an address the reader owns. Each
 * wallet's history is kept apart on the phone, so switching back opens at once.
 *
 * ── Combined ──────────────────────────────────────────────────────────────
 * Wallets can also be read together: all of them, or any two or more the
 * reader picks, as a group. A group is only a list of addresses; each wallet
 * stays on the list and can still be read alone. What the screens read is
 * `active`: a wallet's address, or a group's key (`group:…`).
 */

export interface SavedWallet {
  address: string;
  /** The account's name in the wallet app, when it gave one. */
  label: string | null;
}

export interface WalletGroup {
  id: string;
  /** Two or more addresses from the list. */
  members: string[];
}

export interface Wallets {
  list: SavedWallet[];
  /** The groups the reader made. "All wallets" is not one of them: it is always there once there are two. */
  groups?: WalletGroup[];
  /** What the screens read: a wallet's address or a group's key; null when there is none. */
  active: string | null;
}

const KEY = "wallets:v1";

/** Every wallet on the list, read together. */
export const ALL = "group:all";
export const groupKey = (id: string) => `group:${id}`;
export const isGroup = (key: string | null): key is string => !!key && key.startsWith("group:");

/** The addresses a key reads: one for a wallet, the members for a group; empty when it no longer exists. */
export function membersOf(ws: Wallets, key: string | null): string[] {
  if (!key) return [];
  const have = new Set(ws.list.map((w) => w.address));
  if (key === ALL) return ws.list.length >= 2 ? ws.list.map((w) => w.address) : [];
  if (isGroup(key)) {
    const g = ws.groups?.find((x) => groupKey(x.id) === key);
    const m = g ? g.members.filter((a) => have.has(a)) : [];
    return m.length >= 2 ? m : [];
  }
  return have.has(key) ? [key] : [];
}

/** A group's name: "All wallets", or its wallets' names joined. */
export function groupName(ws: Wallets, key: string): string {
  if (key === ALL) return "All wallets";
  const names = membersOf(ws, key).map((a) => ws.list.find((w) => w.address === a)?.label || shortAddress(a));
  return names.length > 3 ? `${names.slice(0, 2).join(" + ")} + ${names.length - 2} more` : names.join(" + ");
}

/** The groups as the picker lists them: "All wallets" first, once there are two wallets. */
export function groupKeys(ws: Wallets): string[] {
  return [...(ws.list.length >= 2 ? [ALL] : []), ...(ws.groups ?? []).map((g) => groupKey(g.id)).filter((k) => membersOf(ws, k).length)];
}

/** The list with a group of `members` added and made active. The same set again is the group already made. */
export function withGroup(ws: Wallets, members: string[], id = Date.now().toString(36)): Wallets {
  const set = [...new Set(members)].filter((a) => ws.list.some((w) => w.address === a));
  if (set.length < 2) return ws;
  const same = (g: WalletGroup) => g.members.length === set.length && set.every((a) => g.members.includes(a));
  if (set.length === ws.list.length) return { ...ws, active: ALL };
  const had = ws.groups?.find(same);
  if (had) return { ...ws, active: groupKey(had.id) };
  return { ...ws, groups: [...(ws.groups ?? []), { id, members: set }], active: groupKey(id) };
}

/** The list without a group; if it was active, the first wallet takes its place. */
export function withoutGroup(ws: Wallets, key: string): Wallets {
  const groups = (ws.groups ?? []).filter((g) => groupKey(g.id) !== key);
  return { ...ws, groups, active: ws.active === key ? (ws.list[0]?.address ?? null) : ws.active };
}

/** Whatever `active` names, if it still exists; else the first wallet. */
function valid(ws: Wallets): string | null {
  return membersOf(ws, ws.active).length ? ws.active : (ws.list[0]?.address ?? null);
}

export async function loadWallets(): Promise<Wallets> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const w = raw ? (JSON.parse(raw) as Wallets) : null;
    if (w && Array.isArray(w.list)) {
      const ws = { list: w.list, groups: Array.isArray(w.groups) ? w.groups : [], active: w.active };
      return { ...ws, active: valid(ws) };
    }
  } catch {}
  return { list: [], active: null };
}

export function saveWallets(w: Wallets) {
  AsyncStorage.setItem(KEY, JSON.stringify(w)).catch(() => {});
}

/** The list with `w` in it (its label refreshed if it was there) and made active. */
export function withWallet(ws: Wallets, w: SavedWallet): Wallets {
  const i = ws.list.findIndex((x) => x.address === w.address);
  const list = i < 0 ? [...ws.list, w] : ws.list.map((x, k) => (k === i ? { ...x, label: w.label ?? x.label } : x));
  return { ...ws, list, active: w.address };
}

/**
 * The list without `address`, and out of every group; a group left with one
 * wallet is no longer a group. If what was active is gone, the first wallet
 * takes its place.
 */
export function withoutWallet(ws: Wallets, address: string): Wallets {
  const list = ws.list.filter((x) => x.address !== address);
  const groups = (ws.groups ?? []).map((g) => ({ ...g, members: g.members.filter((a) => a !== address) })).filter((g) => g.members.length >= 2);
  const next = { list, groups, active: ws.active === address ? null : ws.active };
  return { ...next, active: valid(next) };
}

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * Why adding a wallet failed, in words the reader can act on, rather than the
 * wallet adapter's Java exception. Two common causes, both seen on a Seeker
 * on 10 Oct 2026: the request expires 30 seconds after it is sent (fixed in
 * the adapter library), so a reader slow to pick a wallet app in Android's
 * chooser gets a wallet that opens and waits for an app that has stopped
 * asking; and some wallet apps (Solflare) ignore a request that reaches them
 * while already open in the background, answering only from a fresh start.
 * The wallet's own refusals arrive as "-1/authorization request failed".
 */
export function connectProblem(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // The chooser, or the wallet app, closed before a wallet answered: nothing was asked, so nothing was declined.
  if (/association cancelled|cancelled by user/i.test(m)) return "Closed before connecting. Tap Add wallet again, pick a wallet app and approve there.";
  if (/ConnectionFailed|websocket|SESSION_TIMEOUT|timed? ?out/i.test(m)) {
    return "The wallet app did not answer in time: the request lasts 30 seconds. Try again and pick the wallet straight away. If it opens without asking to connect, close it (swipe it away in recent apps) first.";
  }
  if (/WALLET_NOT_FOUND|no installed wallet|ActivityNotFound/i.test(m)) {
    return "No wallet app on this phone can connect to apps. Install one, such as Solflare or Jupiter, or use the Seeker's own Wallet.";
  }
  if (/declin|reject|denied|AUTHORI[SZ]ATION[_ ](REQUEST )?FAILED|^-1\/|cancel/i.test(m)) {
    return "The wallet app did not approve the connection. Try again and approve it there.";
  }
  return m.replace(/^[\w.$]+(Exception|Error):\s*/, "").replace(/^-?\d+\//, "");
}
