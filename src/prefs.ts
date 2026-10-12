import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Chart settings the reader chose — resolution, window, indicators, layers —
 * remembered per chart, so a chart reopens as it was left, across restarts.
 *
 * All of them sit in one stored object, read once at launch (`loadPrefs`, from
 * the root layout) and kept in memory, so a chart opened after that renders
 * with its settings on the first frame. A value the reader changes is in
 * memory at once and written to the phone a moment later, so a pinch that
 * changes the window many times a second writes once. Every screen showing
 * it follows at once too: the pattern picked on Breathe is the one the card
 * on Today, still open underneath, shows.
 */

const KEY = "prefs:v1";
let cache: Record<string, unknown> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function loadPrefs(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      // Anything set before the stored copy arrived is newer, and wins.
      if (raw) cache = { ...JSON.parse(raw), ...cache };
    })
    .catch(() => {})
    .finally(() => listeners.forEach((l) => l()));
  return loaded;
}

function save() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  }, 400);
}

type Set_<T> = (next: T | ((prev: T) => T)) => void;

const NONE = Symbol("none");

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * `useState`, remembered under `key`. With `key` null it is plain state.
 * A stored value the chart no longer offers (an option since removed, or
 * one this coin lacks) is the caller's to check; see `oneOf`.
 */
export function usePref<T>(key: string | null, initial: T): [T, Set_<T>] {
  // The default as first given for this key: a fresh `[]` each render would read as a new value each time.
  const [fallback, setFallback] = useState({ key, initial });
  if (fallback.key !== key) setFallback({ key, initial });
  const def = fallback.key === key ? fallback.initial : initial;
  const [own, setOwn] = useState(initial);
  const stored = useSyncExternalStore(subscribe, () => (key !== null && key in cache ? cache[key] : NONE));
  const value = key === null ? own : stored === NONE ? def : (stored as T);

  // On a cold start the stored settings can arrive after the first render.
  useEffect(() => {
    loadPrefs();
  }, []);

  const set = useCallback<Set_<T>>(
    (next) => {
      if (key === null) return setOwn(next);
      const prev = (key in cache ? cache[key] : def) as T;
      cache[key] = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      save();
      listeners.forEach((l) => l());
    },
    [key, def],
  );
  return [value, set];
}

/** `value` if it is among `options`, else `fallback`. */
export const oneOf = <T>(value: T, options: readonly NoInfer<T>[], fallback: NoInfer<T>): T => (options.includes(value) ? value : fallback);

/** Toggle `k` in a list, keeping the rest in order. */
export const toggled = <T>(list: T[], k: T): T[] => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

/** A remembered value outside a component: what a screen will open with, for warming its data ahead. */
export const getPref = <T>(key: string, initial: T): T => (key in cache ? (cache[key] as T) : initial);
