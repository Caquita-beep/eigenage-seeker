import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

/**
 * Chart settings the reader chose — resolution, window, indicators, layers —
 * remembered per chart, so a chart reopens as it was left, across restarts.
 *
 * All of them sit in one stored object, read once at launch (`loadPrefs`, from
 * the root layout) and kept in memory, so a chart opened after that renders
 * with its settings on the first frame. A value the reader changes is in
 * memory at once and written to the phone a moment later, so a pinch that
 * changes the window many times a second writes once.
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

/**
 * `useState`, remembered under `key`. With `key` null it is plain state.
 * A stored value the chart no longer offers (an option since removed, or
 * one this coin lacks) is the caller's to check; see `oneOf`.
 */
export function usePref<T>(key: string | null, initial: T): [T, Set_<T>] {
  const read = (): T => (key !== null && key in cache ? (cache[key] as T) : initial);
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    // On a cold start the stored settings can arrive after the first render.
    const l = () => setValue(read());
    l();
    listeners.add(l);
    loadPrefs();
    return () => {
      listeners.delete(l);
    };
  }, [key]);

  const set = useCallback<Set_<T>>(
    (next) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (key !== null) {
          cache[key] = v;
          save();
        }
        return v;
      }),
    [key],
  );
  return [value, set];
}

/** `value` if it is among `options`, else `fallback`. */
export const oneOf = <T>(value: T, options: readonly NoInfer<T>[], fallback: NoInfer<T>): T => (options.includes(value) ? value : fallback);

/** Toggle `k` in a list, keeping the rest in order. */
export const toggled = <T>(list: T[], k: T): T[] => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

/** A remembered value outside a component: what a screen will open with, for warming its data ahead. */
export const getPref = <T>(key: string, initial: T): T => (key in cache ? (cache[key] as T) : initial);
