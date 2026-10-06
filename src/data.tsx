import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cachedBody, clearBody, importAppleHealth, loadSyntheticWhoop, readHealthConnect, type BodyNights, type SyntheticLinks } from "./body";
import type { Data } from "./engine/hypotheses";
import { dataFor, fingerprint, questionsFor, runExposure, withUnderwater, type Answer } from "./exposure";
import { useCoins, type Coins } from "./holdings";
import { cachedMarket, loadMarket, type MarketView } from "./market";
import { cachedWallet, forgetWallet, loadSyntheticWallet, loadWallet, setSyntheticWallet, syntheticWalletOn, type WalletView } from "./wallet";

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
  address: string | null;
  /** True while the generated trader stands in for a wallet (`wallet.ts`). */
  synthetic: boolean;
  loadSynthetic: () => void;
  removeSynthetic: () => Promise<void>;
  /** Disconnects the wallet and deletes its history from the phone. */
  disconnect: () => Promise<void>;
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
  synthetic: false,
  loadSynthetic: () => {},
  removeSynthetic: async () => {},
  disconnect: async () => {},
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

  return <MarketCtx.Provider value={{ view, busy, error, refresh, ready }}>{children}</MarketCtx.Provider>;
}

export function WalletDataProvider({ children }: { children: ReactNode }) {
  const { account, disconnect } = useMobileWallet();
  const address = account?.address ? String(account.address) : null;
  const { view: market } = useContext(MarketCtx);
  const [synthetic, setSynthetic] = useState(false);
  const [view, setView] = useState<WalletView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const coins = useCoins(view);
  // The market's SOL bars, when it has them, so the synthetic trader is priced
  // without a second fetch. A ref, so a market refresh does not regenerate it.
  const solBars = useRef(market?.solBars);
  solBars.current = market?.solBars;
  const fear = useRef<Map<string, number> | undefined>(undefined);
  fear.current = market?.dvolSeries.length ? new Map(market.dvolSeries.map((d) => [d.day, d.value])) : undefined;
  // The synthetic trader is priced from the market's bars — cached ones count —
  // so it waits for them rather than fetching its own, which fails exactly
  // when the market's fetch does.
  const haveBars = !!market?.solBars?.length;
  // What the screens show now, so a read that finishes after a disconnect is dropped.
  const source = useRef<string | null>(null);
  useEffect(() => {
    source.current = address ?? (synthetic ? "synthetic" : null);
  }, [address, synthetic]);

  // A connected wallet always wins; the synthetic trader only stands in.
  const refresh = useCallback(async () => {
    if (!address && !synthetic) return;
    const from = address ?? "synthetic";
    setBusy(true);
    setError(null);
    try {
      const v = address ? await loadWallet(address) : await loadSyntheticWallet(solBars.current, fear.current);
      if (source.current === from) setView(v);
    } catch (e) {
      if (source.current === from) setError(message(e));
    } finally {
      setBusy(false);
      setReady(true);
    }
  }, [address, synthetic]);

  useEffect(() => {
    Promise.all([syntheticWalletOn(), AsyncStorage.getItem(WALLET_KIT_KEY).catch(() => null)]).then(([on, wallet]) => {
      setSynthetic(on);
      if (!on && !wallet) setReady(true);
    });
  }, []);

  useEffect(() => {
    setView(null);
    setError(null);
    if (address) {
      cachedWallet(address).then((c) => {
        if (c) setView(c);
        setReady(true);
        refresh();
      });
    } else if (synthetic && haveBars) {
      refresh();
    }
  }, [address, synthetic, haveBars, refresh]);

  const value: WalletState = {
    view,
    busy,
    error,
    refresh,
    ready,
    address,
    synthetic: synthetic && !address,
    loadSynthetic: () => setSynthetic(true),
    removeSynthetic: async () => {
      await setSyntheticWallet(false);
      setSynthetic(false);
      if (!address) setView(null);
    },
    disconnect: async () => {
      if (!address) return;
      await disconnect();
      await forgetWallet(address);
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
  importApple: () => Promise<void>;
  connectHealthConnect: () => Promise<void>;
  loadSynthetic: () => Promise<void>;
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
  importApple: async () => {},
  connectHealthConnect: async () => {},
  loadSynthetic: async () => {},
  forget: async () => {},
});

export function BodyProvider({ children }: { children: ReactNode }) {
  const [body, setBody] = useState<BodyNights | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // The synthetic body's planted link, from the market's fear.
  const { view: market } = useContext(MarketCtx);
  const links = useCallback(
    (): SyntheticLinks => ({ fear: market?.dvolSeries.length ? new Map(market.dvolSeries.map((d) => [d.day, d.value])) : undefined }),
    [market],
  );
  const synthetic = useRef(false);

  useEffect(() => {
    cachedBody().then((b) => {
      // A synthetic member is regenerated on open, so it always ends last
      // night rather than on the day it was first loaded. It is deterministic
      // and takes milliseconds.
      synthetic.current = b?.source === "whoop-synthetic";
      if (synthetic.current) {
        loadSyntheticWhoop(() => {}, links())
          .then(setBody, () => setBody(b))
          .then(() => setReady(true));
      } else {
        setBody(b);
        setReady(true);
      }
    });
  }, []);

  // Regenerated again once the market it is linked to arrives or changes.
  useEffect(() => {
    if (!synthetic.current) return;
    let live = true;
    loadSyntheticWhoop(() => {}, links()).then((b) => live && setBody(b), () => {});
    return () => {
      live = false;
    };
  }, [market?.asOf]);

  const run = useCallback(async (fn: (p: (s: string, f?: number) => void) => Promise<BodyNights | null>) => {
    setBusy(true);
    setError(null);
    try {
      const b = await fn((s, f) => {
        setStage(s);
        setFraction(f ?? null);
      });
      if (b) {
        // A real import ends the synthetic member's regeneration for good.
        synthetic.current = b.source === "whoop-synthetic";
        setBody(b);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setStage(null);
      setFraction(null);
    }
  }, []);

  const value: BodyState = {
    body,
    busy,
    stage,
    fraction,
    error,
    ready,
    importApple: () => run(importAppleHealth),
    connectHealthConnect: () => run(readHealthConnect),
    loadSynthetic: () => {
      synthetic.current = true;
      return run((p) => loadSyntheticWhoop(p, links()));
    },
    forget: async () => {
      synthetic.current = false;
      await clearBody();
      setBody(null);
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
// v3: every question worded for HRV recorded during sleep (6 October 2026); v2 added the balance and per-coin ones.
const ANSWERS_KEY = "exposure:answers:v3";

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
        // The same history as last time: the same answers.
        if (live) setAnswers(prev.answers);
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
