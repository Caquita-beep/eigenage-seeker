import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAddressDecoder, getBase64Encoder } from "@solana/kit";
import { MobileWalletProviderContext, transact, useMobileWallet } from "@wallet-ui/react-native-kit";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { cachedBody, clearBody, loadSyntheticWhoop, saveBody, type BodyNights, type SyntheticLinks } from "./body";
import { addReading as saveReading, clearReadings, loadReadings, readingsBody, removeReading as dropReading, type Reading } from "./readings";
import type { Data } from "./engine/hypotheses";
import { dataFor, fingerprint, questionsFor, runExposure, withUnderwater, type Answer } from "./exposure";
import { useCoins, type Coins } from "./holdings";
import { cachedMarket, loadMarket, type MarketView } from "./market";
import { cachedWallet, forgetGroup, forgetWallet, loadGroup, loadSyntheticWallet, loadWallet, setSyntheticWallet, syntheticWalletOn, type WalletView } from "./wallet";
import { TESTING } from "./flags";
import {
  groupKeys,
  groupName,
  isGroup,
  loadWallets,
  membersOf,
  saveWallets,
  withGroup,
  withoutGroup,
  withoutWallet,
  withWallet,
  type SavedWallet,
  type Wallets,
} from "./wallets";

/**
 * One copy of each view for the whole app. The dashboard and the chart pages
 * read the same object, so opening a chart never refetches what the dashboard
 * already has, and a pull-to-refresh anywhere updates everything.
 */

interface Loadable<T> {
  view: T | null;
  busy: boolean;
  error: string | null;
  refresh: () => void;
  /** True once what the phone had saved is on screen, or there was nothing. The launch splash waits for it (`splash.tsx`). */
  ready: boolean;
}

const MarketCtx = createContext<Loadable<MarketView>>({ view: null, busy: false, error: null, refresh: () => {}, ready: false });
interface WalletState extends Loadable<WalletView> {
  /** What the screens read: a wallet's address, or a group's key when several are read together (`wallets.ts`). */
  address: string | null;
  /** Every wallet the reader has added, in the order added (`wallets.ts`). */
  wallets: SavedWallet[];
  /** The groups that can be read: "All wallets" once there are two, then the reader's own. */
  groups: { key: string; name: string; members: string[] }[];
  /** The active group, when one is read. */
  group: { key: string; name: string; members: string[] } | null;
  /** While a group is read: which of its wallets, counting from 1. */
  reading: { done: number; of: number } | null;
  /**
   * Asks the wallet app for an account. A new one is added and becomes the active wallet; one already added is
   * left as it is (`added` false), since a wallet app often hands back the account it gave before.
   */
  addWallet: () => Promise<{ address: string; added: boolean }>;
  /** Reads another added wallet, or a group. Nothing goes to the wallet app. */
  selectWallet: (address: string) => void;
  /** Reads these wallets together, as a group kept for next time; all of them is "All wallets". */
  combine: (addresses: string[]) => void;
  /** Deletes a group. Its wallets stay. */
  removeGroup: (key: string) => Promise<void>;
  /** Takes a wallet off the list and deletes its history from the phone. */
  removeWallet: (address: string) => Promise<void>;
  /** True while the generated trader stands in for a wallet (`wallet.ts`). */
  synthetic: boolean;
  loadSynthetic: () => void;
  removeSynthetic: () => Promise<void>;
  /** Its coins priced now, for the balance and every coin list (`holdings.ts`). */
  coins: Coins;
}

const WalletCtx = createContext<WalletState>({
  view: null,
  busy: false,
  error: null,
  refresh: () => {},
  ready: false,
  address: null,
  wallets: [],
  groups: [],
  group: null,
  reading: null,
  addWallet: async () => ({ address: "", added: false }),
  selectWallet: () => {},
  combine: () => {},
  removeGroup: async () => {},
  removeWallet: async () => {},
  synthetic: false,
  loadSynthetic: () => {},
  removeSynthetic: async () => {},
  coins: { rows: [], priced: false, error: null },
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Where @wallet-ui/react-native-kit keeps the connected wallet (its default key). It restores it a moment after
// opening, so at launch this is the only sign one is coming.
const WALLET_KIT_KEY = "authorization-cache";

export function MarketProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<MarketView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await loadMarket());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    cachedMarket().then((c) => {
      if (c) setView(c.view);
      setReady(true);
      if (!c?.fresh) refresh();
    });
  }, [refresh]);

  // Back in the app after the market moved on: ask again, as on opening.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      cachedMarket().then((c) => {
        if (!c?.fresh) refresh();
      });
    });
    return () => sub.remove();
  }, [refresh]);

  return <MarketCtx.Provider value={{ view, busy, error, refresh, ready }}>{children}</MarketCtx.Provider>;
}

export function WalletDataProvider({ children }: { children: ReactNode }) {
  const { account, disconnect } = useMobileWallet();
  const { chain, identity } = useContext(MobileWalletProviderContext);
  // The added wallets and the active one; null until read from the phone.
  const [saved, setSaved] = useState<Wallets | null>(null);
  const address = saved?.active ?? null;
  // The wallets the active key reads; for a group, a change in them is a change in what is read.
  const members = useMemo(() => (saved ? membersOf(saved, address) : []), [saved, address]);
  const membersSig = members.join(",");
  const [reading, setReading] = useState<{ done: number; of: number } | null>(null);
  const { view: market } = useContext(MarketCtx);
  const [synthetic, setSynthetic] = useState(false);
  const [view, setView] = useState<WalletView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const coins = useCoins(view);
  // The market, when it has bars, so the synthetic trader is priced without a
  // second fetch. A ref, so a market refresh does not regenerate it.
  const marketNow = useRef(market);
  marketNow.current = market;
  // The synthetic trader is priced from the market's bars — cached ones count —
  // so it waits for them rather than fetching its own, which fails exactly
  // when the market's fetch does.
  const haveBars = !!market?.solBars?.length;
  // What the screens show now, so a read that finishes after a switch or a removal is dropped.
  const source = useRef<string | null>(null);
  useEffect(() => {
    source.current = address ?? (synthetic ? "synthetic" : null);
  }, [address, synthetic]);
  // The latest read, so one that a switch overtook does not end the newer one's spinner.
  const reads = useRef(0);

  // Changes the list and saves it. Not before it is read from the phone: a change applied to an empty
  // stand-in would be saved over the wallets there, and the read would then keep the stand-in.
  const update = useCallback((f: (w: Wallets) => Wallets) => {
    setSaved((prev) => {
      if (!prev) return prev;
      const next = f(prev);
      saveWallets(next);
      return next;
    });
  }, []);

  // A wallet always wins; the synthetic trader only stands in.
  const refresh = useCallback(async () => {
    if (!address && !synthetic) return;
    const from = address ?? "synthetic";
    const n = ++reads.current;
    setBusy(true);
    setError(null);
    try {
      const m = marketNow.current;
      const fear = m?.dvolSeries.length ? new Map(m.dvolSeries.map((d) => [d.day, d.value])) : undefined;
      const v = isGroup(address)
        ? await loadGroup(address, membersSig.split(","), (done, of) => reads.current === n && setReading({ done: done + 1, of }))
        : address
          ? await loadWallet(address)
          : await loadSyntheticWallet(m?.solBars, fear);
      if (source.current === from) setView(v);
    } catch (e) {
      if (source.current === from) setError(message(e));
    } finally {
      if (reads.current === n) {
        setBusy(false);
        setReading(null);
      }
      setReady(true);
    }
  }, [address, synthetic, membersSig]);

  useEffect(() => {
    Promise.all([loadWallets(), syntheticWalletOn(), AsyncStorage.getItem(WALLET_KIT_KEY).catch(() => null)]).then(([w, was, kit]) => {
      // Synthetic trades only in a test build (`flags.ts`).
      const on = was && TESTING;
      if (was && !TESTING) setSyntheticWallet(false).catch(() => {});
      setSaved(w);
      setSynthetic(on);
      // A wallet connected before wallets were listed is restored by the kit a moment later (below).
      if (!w.active && !on && !kit) setReady(true);
    });
  }, []);

  // The wallet app's account, as the kit restores or connects it: added if the list does not have it. This
  // carries a wallet connected before the list existed into it.
  const kitAddress = account?.address ? String(account.address) : null;
  const kitLabel = account?.label ?? null;
  useEffect(() => {
    if (!saved || !kitAddress || saved.list.some((w) => w.address === kitAddress)) return;
    update((w) => withWallet(w, { address: kitAddress, label: kitLabel }));
  }, [saved, kitAddress, kitLabel, update]);

  useEffect(() => {
    setView(null);
    setError(null);
    if (address) {
      cachedWallet(address).then((c) => {
        if (source.current !== address) return;
        // A group's saved view counts only while it still adds up the same wallets.
        const same = !isGroup(address) || (!!c?.members && [...c.members].sort().join(",") === [...membersSig.split(",")].sort().join(","));
        if (c && same) setView(c);
        setReady(true);
        refresh();
      });
    } else if (synthetic && haveBars) {
      refresh();
    }
  }, [address, synthetic, haveBars, refresh, membersSig]);

  const value: WalletState = {
    view,
    busy,
    error,
    refresh,
    ready,
    address,
    wallets: saved?.list ?? [],
    groups: saved ? groupKeys(saved).map((key) => ({ key, name: groupName(saved, key), members: membersOf(saved, key) })) : [],
    group: saved && isGroup(address) ? { key: address, name: groupName(saved, address), members } : null,
    reading,
    addWallet: async () => {
      // A fresh approval, never the saved one. With the saved one the wallet app hands back the account it already
      // gave, rather than letting the reader choose another; and a wallet app that has restarted since (Solflare)
      // refuses it outright and closes the request. EigenAge only reads addresses, so nothing is lost; the kit's
      // copy is cleared too, so a stale one is never sent.
      await disconnect().catch(() => {});
      const { accounts } = await transact((w) => w.authorize({ chain, identity }));
      if (!accounts.length) throw new Error("The wallet app gave no account.");
      const a = accounts[0];
      const address = String(getAddressDecoder().decode(getBase64Encoder().encode(a.address)));
      if (saved?.list.some((w) => w.address === address)) return { address, added: false };
      update((w) => withWallet(w, { address, label: a.label ?? null }));
      return { address, added: true };
    },
    selectWallet: (a) => update((w) => (membersOf(w, a).length ? { ...w, active: a } : w)),
    combine: (addresses) => update((w) => withGroup(w, addresses)),
    removeGroup: async (key) => {
      update((w) => withoutGroup(w, key));
      await forgetGroup(key);
    },
    removeWallet: async (a) => {
      if (kitAddress === a) await disconnect().catch(() => {});
      update((w) => withoutWallet(w, a));
      await forgetWallet(a);
    },
    synthetic: synthetic && !address,
    loadSynthetic: () => setSynthetic(true),
    removeSynthetic: async () => {
      await setSyntheticWallet(false);
      setSynthetic(false);
      if (!address) setView(null);
    },
    coins,
  };
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

interface BodyState {
  body: BodyNights | null;
  busy: boolean;
  stage: string | null;
  fraction: number | null;
  error: string | null;
  loadSynthetic: () => Promise<void>;
  /** Every strap reading kept on the phone, oldest first: the mornings and those at other times (`readings.ts`). */
  readings: Reading[];
  /**
   * Keeps a strap reading. A morning's becomes the body's HRV when the strap is its source, or the source if
   * there was none; any other is kept with the readings only.
   */
  addReading: (r: Reading) => Promise<void>;
  /** Deletes one reading. When the strap is the source, the body is built again without it; with no morning left, there is none. */
  removeReading: (at: number) => Promise<void>;
  /** Deletes every reading. When the strap is the source, the body goes with them. */
  removeAllReadings: () => Promise<void>;
  /** Reads the body again from where it came from: Health Connect, a new Apple export, or a fresh synthetic member. */
  refresh: () => Promise<void>;
  /**
   * Deletes the body from the phone, so another source can be connected. The strap's readings, when there
   * are any, are the body again: synthetic data tried in front of them leaves them as they were.
   */
  forget: () => Promise<void>;
  /** True once the body saved on the phone, if any, is on screen. The launch splash waits for it (`splash.tsx`). */
  ready: boolean;
}

const BodyCtx = createContext<BodyState>({
  body: null,
  busy: false,
  stage: null,
  fraction: null,
  error: null,
  ready: false,
  readings: [],
  loadSynthetic: async () => {},
  addReading: async () => {},
  removeReading: async () => {},
  removeAllReadings: async () => {},
  refresh: async () => {},
  forget: async () => {},
});


export function BodyProvider({ children }: { children: ReactNode }) {
  const [body, setBody] = useState<BodyNights | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  useEffect(() => {
    loadReadings().then(setReadings);
  }, []);

  // The synthetic body's planted link, from the market's fear. A ref, so a read started before the market
  // arrived still links to it.
  const { view: market } = useContext(MarketCtx);
  const marketNow = useRef(market);
  marketNow.current = market;
  const links = (): SyntheticLinks => {
    const m = marketNow.current;
    return { fear: m?.dvolSeries.length ? new Map(m.dvolSeries.map((d) => [d.day, d.value])) : undefined };
  };
  const synthetic = useRef(false);
  const source = useRef<BodyNights["source"] | null>(null);
  // Bumped by every import and by forget, so a read that finishes after either is dropped, not saved back.
  const gen = useRef(0);
  const readAt = useRef(0);

  const keep = useCallback((b: BodyNights) => {
    synthetic.current = b.source === "whoop-synthetic";
    source.current = b.source;
    setBody(b);
    saveBody(b).catch(() => {});
  }, []);

  useEffect(() => {
    cachedBody().then(async (cached) => {
      let b = cached;
      // Synthetic data from a test build has no place in the app people install (`flags.ts`): the strap's
      // readings, if any, are the body again.
      if (b?.source === "whoop-synthetic" && !TESTING) {
        await clearBody().catch(() => {});
        b = readingsBody(await loadReadings());
        if (b) saveBody(b).catch(() => {});
      }
      source.current = b?.source ?? null;
      // A synthetic member is regenerated on open, so it always ends last
      // night rather than on the day it was first loaded. It is deterministic
      // and takes milliseconds.
      synthetic.current = b?.source === "whoop-synthetic";
      if (synthetic.current) {
        const g = gen.current;
        loadSyntheticWhoop(() => {}, links())
          .then((x) => gen.current === g && setBody(x), () => setBody(b))
          .then(() => setReady(true));
      } else {
        setBody(b);
        setReady(true);
      }
    });
    // Once, on opening.
  }, []);

  // Regenerated again once the market it is linked to arrives or changes.
  useEffect(() => {
    if (!synthetic.current) return;
    let live = true;
    const g = gen.current;
    loadSyntheticWhoop(() => {}, links()).then((b) => live && gen.current === g && setBody(b), () => {});
    return () => {
      live = false;
    };
  }, [market?.asOf]);

  const run = useCallback(
    async (fn: (p: (s: string, f?: number) => void) => Promise<BodyNights | null>) => {
      const g = ++gen.current;
      setBusy(true);
      setError(null);
      try {
        const b = await fn((s, f) => {
          setStage(s);
          setFraction(f ?? null);
        });
        // A real import ends the synthetic member's regeneration for good.
        if (b && gen.current === g) {
          readAt.current = Date.now();
          keep(b);
        }
      } catch (e) {
        if (gen.current === g) setError(message(e));
      } finally {
        setBusy(false);
        setStage(null);
        setFraction(null);
      }
    },
    [keep],
  );

  const loadSynthetic = () => run((p) => loadSyntheticWhoop(p, links()));
  const fromReadings = () =>
    run(async () => {
      const list = await loadReadings();
      setReadings(list);
      return readingsBody(list);
    });
  const value: BodyState = {
    body,
    busy,
    stage,
    fraction,
    error,
    ready,
    loadSynthetic,
    readings,
    addReading: (r) =>
      run(async () => {
        const list = await saveReading(r);
        setReadings(list);
        // The readings are the body only when the strap is its source, or there is none yet.
        return !source.current || source.current === "strap" ? readingsBody(list) : null;
      }),
    refresh: () =>
      body?.source === "strap" ? fromReadings() : body ? loadSynthetic() : Promise.resolve(),
    removeReading: async (at) => {
      const list = await dropReading(at);
      setReadings(list);
      if (source.current !== "strap") return;
      const b = readingsBody(list);
      if (b) {
        keep(b);
        return;
      }
      gen.current++;
      source.current = null;
      await clearBody();
      setBody(null);
    },
    removeAllReadings: async () => {
      await clearReadings();
      setReadings([]);
      if (source.current !== "strap") return;
      gen.current++;
      source.current = null;
      await clearBody();
      setBody(null);
    },
    forget: async () => {
      // A strap's readings exist nowhere else; removing the body removes them.
      const strap = source.current === "strap";
      if (strap) {
        await clearReadings();
        setReadings([]);
      }
      gen.current++;
      synthetic.current = false;
      source.current = null;
      setError(null);
      await clearBody();
      const back = strap ? null : readingsBody(await loadReadings());
      if (back) keep(back);
      else setBody(null);
    },
  };
  return <BodyCtx.Provider value={value}>{children}</BodyCtx.Provider>;
}

interface ExposureState {
  answers: Answer[] | null;
  progress: [number, number] | null;
  /** The series the questions were asked of, for drawing their evidence. */
  data: Data | null;
}
const ExposureCtx = createContext<ExposureState>({ answers: null, progress: null, data: null });
// v6: the questions' method amended after a simulation check: a trend on every question, yes-or-no exposures'
// evidence counted by stretches, the morning before's HRV held fixed (8 October 2026, `engine/hypotheses.ts`).
// v5: HRV named for the morning it is shown, "the next morning", not "that night" (7 October 2026).
// v4: the underwater question asks about the day before the night, like the rest (7 October 2026).
// v3: every question worded for HRV recorded during sleep (6 October 2026); v2 added the balance and per-coin ones.
const ANSWERS_KEY = "exposure:answers:v6";

/**
 * The questions, re-asked whenever the market, the wallet or the body
 * changes. They are the whole point of joining the three, so they live beside
 * the data rather than on any one screen.
 */
export function ExposureProvider({ children }: { children: ReactNode }) {
  const { view: market } = useContext(MarketCtx);
  const { view: wallet, address, synthetic } = useContext(WalletCtx);
  const { body } = useContext(BodyCtx);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [data, setData] = useState<Data | null>(null);

  // A wallet disconnected or swapped, or synthetic trades removed: the answers asked of it
  // go with it, rather than show until new ones are asked.
  const walletFrom = address ?? (synthetic ? "synthetic" : null);
  const lastFrom = useRef(walletFrom);
  useEffect(() => {
    if (lastFrom.current && lastFrom.current !== walletFrom) {
      setAnswers(null);
      AsyncStorage.removeItem(ANSWERS_KEY).catch(() => {});
    }
    lastFrom.current = walletFrom;
  }, [walletFrom]);

  // The last answers, shown at once on opening while today's are checked.
  useEffect(() => {
    AsyncStorage.getItem(ANSWERS_KEY)
      .then((raw) => raw && setAnswers((prev) => prev ?? (JSON.parse(raw) as { answers: Answer[] }).answers))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!market) return;
    let live = true;
    // The market, the wallet and the body arrive one after another on opening: wait for them to settle
    // rather than start a run the next arrival would cancel. Each run is seconds of work on the phone.
    const timer = setTimeout(async () => {
      const d = await withUnderwater(dataFor(market, wallet, body), market, wallet);
      if (!live) return;
      setData(d);
      const fp = fingerprint(d);
      const kept = await AsyncStorage.getItem(ANSWERS_KEY).catch(() => null);
      const prev = kept ? (JSON.parse(kept) as { fp: string; answers: Answer[] }) : null;
      if (prev?.fp === fp) {
        // The same history as last time: the same answers. A run this replaced may have left its progress showing.
        if (live) {
          setAnswers(prev.answers);
          setProgress(null);
        }
        return;
      }
      const qs = await questionsFor(d);
      if (!live) return;
      const a = await runExposure(d, qs, (k, t) => live && setProgress([k, t]), () => live);
      if (!live) return;
      setAnswers(a);
      setProgress(null);
      AsyncStorage.setItem(ANSWERS_KEY, JSON.stringify({ fp, answers: a })).catch(() => {});
    }, 1200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [market?.asOf, wallet?.asOf, body?.importedAt]);

  return <ExposureCtx.Provider value={{ answers, progress, data }}>{children}</ExposureCtx.Provider>;
}

export const useMarket = () => useContext(MarketCtx);
export const useBody = () => useContext(BodyCtx);
export const useExposure = () => useContext(ExposureCtx);
export const useWalletData = () => useContext(WalletCtx);
