import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, PermissionsAndroid, Platform } from "react-native";
import HeartStrap from "../modules/heart-strap";
import { parseMeasurement } from "./rr";

/**
 * The chest strap, found and kept connected while a reading screen is open
 * (`app/reading.tsx`). The native side only scans, connects and hands over
 * bytes (`modules/heart-strap`); everything is read here and in `rr.ts`.
 *
 * The strap used last is remembered, and connected as soon as a scan sees
 * it, so after the first morning the reading starts without a tap. A strap
 * that drops mid-reading is tried again, and the beats after the drop are
 * marked so no difference is taken across it.
 *
 * A simulated strap feeds generated beats through the same parsing, for
 * seeing the screen work without one. Its readings are never saved.
 */

export interface Strap {
  id: string;
  name: string;
}

export type StrapState =
  | { kind: "starting" }
  /** No Bluetooth here, or the native module is not built in. */
  | { kind: "unsupported" }
  | { kind: "off" }
  | { kind: "denied" }
  | { kind: "scanning"; found: Strap[] }
  | { kind: "connecting"; strap: Strap }
  | { kind: "connected"; strap: Strap }
  | { kind: "lost"; strap: Strap; error: string | null };

/** One Heart Rate Measurement, parsed. `gap` when beats were lost since the one before. */
export interface Packet {
  hr: number;
  contact: boolean | null;
  rr: number[];
  gap: boolean;
  at: number;
}

export const SIMULATED: Strap = { id: "simulated", name: "Simulated strap" };

const KEY = "strap:last:v1";
/** A strap sends a measurement about every second; a longer silence lost beats. */
const GAP_MS = 2500;
/** A strap that drops is tried again this many times before the screen says so. */
const RETRIES = 3;

async function permitted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const r = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => r[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** The strap used last, if any: a screen that only might use one (`app/breathe.tsx`) looks for it only then. */
export async function remembered(): Promise<Strap | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Strap) : null;
  } catch {
    return null;
  }
}

export const openSettings = () => Linking.openSettings();

export function useStrap(onPacket: (p: Packet) => void) {
  const [state, setState] = useState<StrapState>(() => (HeartStrap ? { kind: "starting" } : { kind: "unsupported" }));
  const deliverTo = useRef(onPacket);
  useEffect(() => {
    deliverTo.current = onPacket;
  });
  const current = useRef<Strap | null>(null);
  const phase = useRef<StrapState["kind"]>("starting");
  const lastAt = useRef(0);
  const tries = useRef(0);
  const last = useRef<Strap | null>(null);
  const sim = useRef<ReturnType<typeof setInterval> | null>(null);

  const set = useCallback((s: StrapState) => {
    phase.current = s.kind;
    setState(s);
  }, []);

  const deliver = useCallback((bytes: ArrayLike<number>, at: number) => {
    const m = parseMeasurement(bytes);
    if (!m) return;
    const gap = lastAt.current > 0 && at - lastAt.current > GAP_MS;
    lastAt.current = at;
    deliverTo.current({ ...m, gap, at });
  }, []);

  const stopSim = () => {
    if (sim.current) clearInterval(sim.current);
    sim.current = null;
  };

  const scan = useCallback(() => {
    if (!HeartStrap) return set({ kind: "unsupported" });
    current.current = null;
    try {
      HeartStrap.startScan();
      set({ kind: "scanning", found: [] });
    } catch {
      set({ kind: "off" });
    }
  }, [set]);

  const connect = useCallback(
    (s: Strap) => {
      stopSim();
      current.current = s;
      tries.current = 0;
      if (s.id === SIMULATED.id) {
        HeartStrap?.disconnect();
        const next = simulatedBeats();
        let clock = 0;
        let owed = next();
        const started = Date.now();
        sim.current = setInterval(() => {
          const t = Date.now() - started;
          const rr: number[] = [];
          while (clock + owed <= t) {
            clock += owed;
            rr.push(owed);
            owed = next();
          }
          const hr = rr.length ? Math.round(60_000 / (rr.reduce((a, b) => a + b, 0) / rr.length)) : 60;
          deliver(encodeMeasurement(hr, rr), Date.now());
        }, 1000);
        set({ kind: "connected", strap: s });
        return;
      }
      HeartStrap?.connect(s.id);
      set({ kind: "connecting", strap: s });
    },
    [deliver, set],
  );

  /** From the top: permission, Bluetooth, then a scan that connects the remembered strap when it shows up. */
  const begin = useCallback(async () => {
    stopSim();
    // Without the module the state is already "unsupported", from the start.
    if (!HeartStrap) return;
    if (!(await permitted())) return set({ kind: "denied" });
    const bt = HeartStrap.bluetooth();
    if (bt === "none") return set({ kind: "unsupported" });
    if (bt === "off") return set({ kind: "off" });
    last.current = await remembered();
    scan();
  }, [scan, set]);

  useEffect(() => {
    if (!HeartStrap) return () => stopSim();
    const subs = [
      HeartStrap.addListener("onDevice", (d) => {
        if (phase.current !== "scanning") return;
        const strap = { id: d.id, name: d.name || "Heart-rate strap" };
        if (last.current?.id === d.id) return connect({ ...strap, name: d.name || last.current.name });
        setState((s) => {
          if (s.kind !== "scanning") return s;
          const found = s.found.some((x) => x.id === d.id) ? s.found.map((x) => (x.id === d.id ? strap : x)) : [...s.found, strap];
          return { kind: "scanning", found };
        });
      }),
      HeartStrap.addListener("onState", (e) => {
        const s = current.current;
        if (!s || s.id === SIMULATED.id || (e.id && e.id !== s.id)) return;
        if (e.state === "connected") {
          tries.current = 0;
          const named = { id: s.id, name: e.name || s.name };
          current.current = named;
          last.current = named;
          AsyncStorage.setItem(KEY, JSON.stringify(named)).catch(() => {});
          set({ kind: "connected", strap: named });
        } else if (e.state === "disconnected") {
          // Android often fails a first connection attempt; a strap that dropped is usually back a moment later.
          if (tries.current < RETRIES) {
            tries.current++;
            setTimeout(() => current.current?.id === s.id && phase.current !== "lost" && HeartStrap?.connect(s.id), 600);
            set({ kind: "connecting", strap: s });
          } else {
            set({ kind: "lost", strap: s, error: e.error ?? null });
          }
        }
      }),
      HeartStrap.addListener("onMeasurement", (e) => {
        if (current.current && e.id === current.current.id) deliver(e.bytes, e.at);
      }),
    ];
    // It sets state only after awaiting the permission prompt, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin();
    return () => {
      subs.forEach((x) => x.remove());
      stopSim();
      current.current = null;
      HeartStrap?.disconnect();
    };
    // Once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Forgets the remembered strap and looks again. */
  const another = useCallback(() => {
    stopSim();
    HeartStrap?.disconnect();
    last.current = null;
    AsyncStorage.removeItem(KEY).catch(() => {});
    scan();
  }, [scan]);

  return { state, connect, retry: begin, another, simulate: () => connect(SIMULATED) };
}

/** A Heart Rate Measurement as a strap would send it: 8-bit heart rate, contact detected, intervals in 1/1024 s. */
export function encodeMeasurement(hr: number, rr: number[]): number[] {
  const out = [0x16, Math.max(0, Math.min(255, Math.round(hr)))];
  for (const x of rr) {
    const v = Math.round((x * 1024) / 1000);
    out.push(v & 0xff, (v >> 8) & 0xff);
  }
  return out;
}

/**
 * A resting heart at about 58 bpm: breathing every 4 s swings each interval
 * by about ±45 ms (the beat-to-beat change rMSSD measures), slower drift and
 * noise on top, and an early beat now and then, with its long pause after,
 * for the cleaning to catch.
 */
export function simulatedBeats(seed = Date.now() % 100_000): () => number {
  let s = seed || 1;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  let t = 0;
  let drift = 0;
  let pause = 0;
  return () => {
    if (pause) {
      const r = pause;
      pause = 0;
      t += r;
      return r;
    }
    drift = 0.98 * drift + 6 * gauss();
    const rr = 1030 + 45 * Math.sin((2 * Math.PI * t) / 4000) + drift + 12 * gauss();
    if (rand() < 0.012) {
      const early = rr * 0.62;
      pause = 2 * rr - early;
      t += early;
      return early;
    }
    t += rr;
    return rr;
  };
}
