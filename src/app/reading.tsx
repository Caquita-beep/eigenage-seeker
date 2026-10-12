import { useKeepAwake } from "expo-keep-awake";
import { router, Stack } from "expo-router";
import { useEffect, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line as SvgLine, Path, Rect } from "react-native-svg";
import { sourceName } from "../bodyview";
import { useBody } from "../data";
import { patternOf } from "../breath";
import { DOWN, UP } from "../indicators";
import { usePref } from "../prefs";
import { isMorning, MORNING_UNTIL_HOUR, morningNight, thisMorning, type Reading as Saved } from "../readings";
import { analyse, usable, type Analysis, type Beat } from "../rr";
import { openSettings, SIMULATED, useStrap, type Packet, type StrapState } from "../strap";
import { color, space, type } from "../theme";
import { ResToggle } from "../ui";
import { TESTING } from "../flags";

/**
 * An HRV reading with a chest strap, sitting still (`howto.tsx`): a minute to
 * settle, not recorded, then one minute unless the reader sets it longer,
 * breathing as it comes: paced breathing lifts HRV and blurs one reading
 * against the next, so it is an exercise (`app/breathe.tsx`), not part of a
 * reading. rMSSD over the whole of it, always kept (`readings.ts`) with its
 * length, since that moves the figure too. Taken on waking,
 * before MORNING_UNTIL_HOUR, it is the morning's reading, the HRV the trend is
 * built from when the strap is the body's source; later, it is kept apart, as
 * a reading at another time.
 *
 * As it records: every beat's interval as it arrives, with the beats the
 * cleaning skips in red (`rr.ts`); and the HRV so far, which settles as the
 * beats add up, as a line or as twelve candles (open and close the first and
 * last figure, high and low the extremes).
 */

const MINUTE = 60_000;
/** The longest reading the reader can set, minutes. */
const MAX_MINUTES = 20;
/** Beats the strap sends before the minute starts, so it starts on a heart already being read. */
const SETTLE_BEATS = 3;
/** Still before the reading, not recorded: getting up and sitting down move the heart for a minute or so. */
const SETTLE_MS = 60_000;
/** saved: the morning's, in the trend; kept: another time's, kept apart. */
type Outcome = "saved" | "kept" | "simulated" | "poor";
type Chart = "line" | "candles";
/** `ms`: the reading's length, set when it starts. `since`: when Start was pressed; `until`: when the settling ends. */
type Phase =
  | { kind: "ready" }
  | { kind: "settling"; since: number; until: number; seen: number; ms: number }
  | { kind: "recording"; since: number; from: number; ms: number }
  | { kind: "done"; from: number; ms: number; a: Analysis };

interface State {
  phase: Phase;
  beats: Beat[];
  /** The HRV so far, each time a packet came. */
  trace: { at: number; v: number }[];
  hr: number | null;
  contact: boolean | null;
  now: number;
}

type Action = { type: "packet"; p: Packet } | { type: "tick"; now: number } | { type: "start"; ms: number } | { type: "skip" } | { type: "reset" };

const done = (st: State, r: { from: number; ms: number }): State => ({ ...st, phase: { kind: "done", from: r.from, ms: r.ms, a: analyse(st.beats) } });

/** The reading, as beats arrive. */
function reduce(st: State, x: Action): State {
  switch (x.type) {
    case "packet": {
      const { p } = x;
      const base = { ...st, hr: p.hr || null, contact: p.contact, now: p.at };
      const add = (beats: Beat[]) => [...beats, ...p.rr.map((rr, i) => ({ rr, gap: i === 0 && p.gap }))];
      if (st.phase.kind === "settling") {
        const seen = st.phase.seen + p.rr.length;
        const { since, until, ms } = st.phase;
        return seen >= SETTLE_BEATS && p.at >= until && p.contact !== false
          ? { ...base, beats: [], phase: { kind: "recording", since, from: p.at, ms } }
          : { ...base, phase: { kind: "settling", since, until, seen, ms } };
      }
      if (st.phase.kind === "recording") {
        const beats = add(st.beats);
        const v = analyse(beats).rmssd;
        const next = { ...base, beats, trace: v === null ? st.trace : [...st.trace, { at: p.at, v }] };
        return p.at - st.phase.from >= st.phase.ms ? done(next, st.phase) : next;
      }
      return base;
    }
    case "tick":
      // The reading ends on time even if the strap goes quiet.
      if (st.phase.kind === "recording" && x.now - st.phase.from >= st.phase.ms + 3000) return done({ ...st, now: x.now }, st.phase);
      return { ...st, now: x.now };
    case "start":
      return { ...st, beats: [], trace: [], phase: { kind: "settling", since: st.now, until: st.now + SETTLE_MS, seen: 0, ms: x.ms } };
    case "skip":
      // Already settled: the reading starts on the next beats.
      return st.phase.kind === "settling" ? { ...st, phase: { ...st.phase, until: 0 } } : st;
    case "reset":
      return { ...st, beats: [], trace: [], phase: { kind: "ready" } };
  }
}

export default function Reading() {
  useKeepAwake();
  const { body, addReading, readings } = useBody();
  // Whether a morning's reading is the body's HRV: the strap is its source, or there is none yet.
  const trend = !body || body.source === "strap";
  const [st, dispatch] = useReducer(reduce, null, (): State => ({
    phase: { kind: "ready" },
    beats: [],
    trace: [],
    hr: null,
    contact: null,
    now: Date.now(),
  }));
  const { phase } = st;
  const [chart, setChart] = usePref<Chart>("reading:chart", "line");
  // How long: the reader's last choice, kept for next time.
  const [minutes, setMinutes] = usePref<number>("reading:minutes", 1);

  const { state, connect, retry, another, simulate } = useStrap((p) => dispatch({ type: "packet", p }));
  const strap = state.kind === "connected" || state.kind === "connecting" || state.kind === "lost" ? state.strap : null;
  const simulated = strap?.id === SIMULATED.id;

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 250);
    return () => clearInterval(t);
  }, []);

  const outcome: Outcome | null =
    phase.kind !== "done" ? null : simulated ? "simulated" : !usable(phase.a) ? "poor" : morningNight(phase.from) ? "saved" : "kept";
  // Before the minute: whether it will be the morning's, and whether this morning's is taken.
  const am = thisMorning(readings, st.now);
  const morning = morningNight("from" in phase ? phase.from : st.now) !== null;

  // Saved once, when the minute ends well.
  const saved = useRef(0);
  useEffect(() => {
    if (phase.kind !== "done" || (outcome !== "saved" && outcome !== "kept") || !strap || saved.current === phase.from) return;
    saved.current = phase.from;
    addReading({
      at: phase.from,
      night: morningNight(phase.from),
      rmssd: phase.a.rmssd!,
      hr: phase.a.hr!,
      beats: phase.a.beats,
      skipped: phase.a.skipped,
      device: strap.name,
      rr: st.beats.map((b) => Math.round(b.rr * 10) / 10),
      ...(phase.ms !== MINUTE ? { minutes: phase.ms / MINUTE } : {}),
    });
  }, [phase, outcome, strap, st.beats, addReading]);

  const connected = state.kind === "connected";
  const a = phase.kind === "done" ? phase.a : analyse(st.beats);
  const length = phase.kind === "ready" ? minutes * MINUTE : phase.ms;
  const left = phase.kind === "recording" ? Math.max(0, length - (st.now - phase.from)) : length;
  // The bar: the settling in a quiet grey, then the reading.
  const bar =
    phase.kind === "done"
      ? 1
      : phase.kind === "settling"
        ? phase.until > phase.since
          ? Math.min(1, (st.now - phase.since) / (phase.until - phase.since))
          : 1
        : (length - left) / length;
  const last = readings.filter(isMorning).at(-1) ?? null;

  return (
    <>
      <Stack.Screen options={{ title: "HRV reading" }} />
      <ScrollView contentContainerStyle={s.content}>

        <StrapLine state={state} contact={st.contact} connect={connect} retry={retry} another={another} simulate={simulate} />

        {phase.kind === "ready" ? <Settings minutes={minutes} setMinutes={setMinutes} /> : null}

        <View style={s.card}>
          <View style={s.figs}>
            <Fig label={phase.kind === "done" ? "HRV · rMSSD" : "HRV so far"} value={a.rmssd !== null ? a.rmssd.toFixed(0) : "–"} unit="ms" big />
            <Fig label="Heart rate" value={phase.kind === "done" ? (a.hr?.toFixed(0) ?? "–") : st.hr ? `${st.hr}` : "–"} unit="bpm" />
          </View>
          <View style={{ gap: space.xs }}>
            <View style={s.track}>
              <View style={[s.fill, phase.kind === "settling" && { backgroundColor: color.faint }, { width: `${bar * 100}%` }]} />
            </View>
            <Text style={type.small}>
              {phase.kind === "recording"
                ? `${clock(left)} left · ${a.beats} beats${a.skipped ? `, ${a.skipped} skipped` : ""}`
                : phase.kind === "settling"
                  ? st.now < phase.until
                    ? `Settling · ${clock(phase.until - st.now)}. Not recorded yet: keep still.`
                    : "Starting…"
                  : phase.kind === "done"
                    ? `${a.beats} beats${a.skipped ? `, ${a.skipped} skipped` : ""}`
                    : `A minute to settle, then ${minutes === 1 ? "one minute" : `${minutes} minutes`} recorded. Sit still and breathe normally.`}
            </Text>
          </View>
          <Trace beats={st.beats} flags={phase.kind === "done" ? phase.a.flags : undefined} />
          {"from" in phase ? (
            <>
              <ResToggle
                options={[
                  { key: "line", label: "Line" },
                  { key: "candles", label: "Candles" },
                ]}
                value={chart}
                onChange={setChart}
                flush
              />
              {st.trace.length > 1 ? (
                chart === "candles" ? <HrvCandles points={st.trace} from={phase.from} span={phase.ms} /> : <HrvLine points={st.trace} from={phase.from} span={phase.ms} />
              ) : (
                <Text style={type.small}>HRV shows after about ten beats.</Text>
              )}
            </>
          ) : null}
        </View>

        {phase.kind === "ready" ? (
          <>
            <Note am={am} morning={morning} trend={trend} last={last} minutes={minutes} />
            <Link label="How to measure ›" onPress={() => router.push("/howto" as never)} />
          </>
        ) : null}

        {phase.kind === "done" && outcome ? <Result outcome={outcome} a={phase.a} trend={trend} source={body && !trend ? sourceName(body) : null} /> : null}

        {connected ? (
          phase.kind === "ready" ? (
            <Button label="Start" onPress={() => dispatch({ type: "start", ms: minutes * MINUTE })} />
          ) : phase.kind === "done" ? (
            <View style={{ gap: space.m }}>
              <View style={{ flexDirection: "row", gap: space.s }}>
                <Button label="Measure again" onPress={() => dispatch({ type: "reset" })} quiet />
                <Button label="Done" onPress={() => router.back()} />
              </View>
              <Link label="Your readings ›" onPress={() => router.push("/readings" as never)} />
            </View>
          ) : phase.kind === "settling" && st.now < phase.until ? (
            <View style={{ flexDirection: "row", gap: space.s }}>
              <Button label="Cancel" onPress={() => dispatch({ type: "reset" })} quiet />
              <Button label="Already settled" onPress={() => dispatch({ type: "skip" })} quiet />
            </View>
          ) : (
            <Button label="Cancel" onPress={() => dispatch({ type: "reset" })} quiet />
          )
        ) : null}
        {simulated ? <Text style={[type.small, { color: color.synthetic }]}>Simulated beats, generated on this phone. Nothing from them is saved.</Text> : null}
      </ScrollView>
    </>
  );
}

function StrapLine({
  state,
  contact,
  connect,
  retry,
  another,
  simulate,
}: { state: StrapState; contact: boolean | null; connect: (s: { id: string; name: string }) => void; retry: () => void; another: () => void; simulate: () => void }) {
  // A simulated strap only in a test build (`flags.ts`).
  const sim = TESTING ? <Link label="No strap? Use a simulated one" onPress={simulate} tint={color.synthetic} /> : null;
  switch (state.kind) {
    case "starting":
      return <Text style={type.small}>Starting Bluetooth…</Text>;
    case "unsupported":
      return (
        <View style={s.box}>
          <Text style={s.boxText}>This phone cannot use a Bluetooth strap.</Text>
          {sim}
        </View>
      );
    case "off":
      return (
        <View style={s.box}>
          <Text style={s.boxText}>Bluetooth is off. Turn it on, then try again.</Text>
          <Link label="Try again" onPress={retry} />
        </View>
      );
    case "denied":
      return (
        <View style={s.box}>
          <Text style={s.boxText}>Heart Alpha needs the Nearby devices permission to find your strap.</Text>
          <View style={{ flexDirection: "row", gap: space.l }}>
            <Link label="Open settings" onPress={openSettings} />
            <Link label="Try again" onPress={retry} />
          </View>
        </View>
      );
    case "scanning":
      return (
        <View style={s.box}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <ActivityIndicator color={color.body} size="small" />
            <Text style={s.boxText}>Looking for your strap. Put it on with the electrodes wet.</Text>
          </View>
          {state.found.map((d) => (
            <Pressable key={d.id} onPress={() => connect(d)} style={({ pressed }) => [s.device, pressed && { opacity: 0.6 }]}>
              <Text style={s.deviceName}>{d.name}</Text>
              <Text style={s.deviceUse}>Use ›</Text>
            </Pressable>
          ))}
          {sim}
        </View>
      );
    case "connecting":
      return (
        <View style={[s.box, { flexDirection: "row", alignItems: "center", gap: space.s }]}>
          <ActivityIndicator color={color.body} size="small" />
          <Text style={s.boxText}>Connecting to {state.strap.name}…</Text>
        </View>
      );
    case "connected":
      return (
        <View style={s.box}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[s.boxText, { color: state.strap.id === SIMULATED.id ? color.synthetic : color.text, fontWeight: "600" }]}>{state.strap.name}</Text>
            {state.strap.id !== SIMULATED.id ? <Link label="Another strap" onPress={another} /> : null}
          </View>
          {contact === false ? <Text style={[s.boxText, { color: color.below }]}>No skin contact. Wet the electrodes and tighten the strap.</Text> : null}
        </View>
      );
    case "lost":
      return (
        <View style={s.box}>
          <Text style={s.boxText}>Lost {state.strap.name}.{state.error ? ` ${state.error}` : ""}</Text>
          <View style={{ flexDirection: "row", gap: space.l }}>
            <Link label="Try again" onPress={retry} />
            <Link label="Another strap" onPress={another} />
          </View>
        </View>
      );
  }
}

/** "1 minute", "5 minutes". */
const length_ = (minutes: number) => (minutes === 1 ? "1 minute" : `${minutes} minutes`);

/**
 * What this reading will be, before it starts: the morning's, a second go at it, or a reading at another time.
 * A morning set up unlike the last one says so: its length moves the figure, and an older one may have been paced.
 */
function Note({
  am,
  morning,
  trend,
  last,
  minutes,
}: {
  am: ReturnType<typeof thisMorning>;
  morning: boolean;
  trend: boolean;
  last: Saved | null;
  minutes: number;
}) {
  const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const lastPattern = last ? patternOf(last.breath) : null;
  const unlike =
    !morning || !last ? null : lastPattern ? (
      <Text style={[s.noteText, { color: color.text }]}>
        Your last morning reading was taken with {lastPattern.name} breathing, and this one is breathing normally: the two do not compare closely.
      </Text>
    ) : (last.minutes ?? 1) !== minutes ? (
      <Text style={[s.noteText, { color: color.text }]}>Your last morning reading was {length_(last.minutes ?? 1)}. Take this one the same length, so the two compare.</Text>
    ) : null;
  if (morning && am.kind === "due") {
    return (
      <View style={s.note}>
        <Text style={s.noteTitle}>This is your morning reading</Text>
        <Text style={s.noteText}>
          On waking, after the bathroom, before coffee or your phone. Sit still and breathe normally. Taken the same way each
          morning, it is compared only with your other mornings.{trend ? " It goes into your HRV trend." : ""}
        </Text>
        {unlike}
      </View>
    );
  }
  if (morning && am.kind === "done") {
    return (
      <View style={s.note}>
        <Text style={s.noteText}>
          This morning&apos;s reading is taken: {am.r.rmssd.toFixed(0)} ms at {time(am.r.at)}. Measuring again replaces it.
        </Text>
        {unlike}
      </View>
    );
  }
  return (
    <View style={s.note}>
      <Text style={s.noteText}>
        After {MORNING_UNTIL_HOUR}:00, a reading is kept with your other readings, apart from your morning trend: HRV is lower later in the day, so the two
        are not compared.
      </Text>
    </View>
  );
}

/** How long: set before the reading starts. */
function Settings({ minutes, setMinutes }: { minutes: number; setMinutes: (f: (m: number) => number) => void }) {
  return (
    <View style={s.box}>
      <View style={s.setRow}>
        <Text style={s.setLabel}>Length</Text>
        <View style={s.stepper}>
          <Step label="−" onPress={() => setMinutes((m) => Math.max(1, m - 1))} disabled={minutes <= 1} />
          <Text style={s.stepValue}>{minutes} min</Text>
          <Step label="+" onPress={() => setMinutes((m) => Math.min(MAX_MINUTES, m + 1))} disabled={minutes >= MAX_MINUTES} />
        </View>
      </View>
    </View>
  );
}

function Step({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => [s.step, (pressed || disabled) && { opacity: 0.35 }]}>
      <Text style={s.stepText}>{label}</Text>
    </Pressable>
  );
}

/** "42 s", or "3:05" from a minute up. */
function clock(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec} s`;
}

function Result({ outcome, a, trend, source }: { outcome: Outcome; a: Analysis; trend: boolean; source: string | null }) {
  const text =
    outcome === "saved"
      ? trend
        ? "Saved as this morning's reading."
        : `Saved with your readings. Your HRV trend comes from ${source}.`
      : outcome === "kept"
        ? `Saved with your other readings. Your morning trend uses readings taken before ${MORNING_UNTIL_HOUR}:00 only: HRV changes through the day.`
        : outcome === "simulated"
          ? "Simulated: not saved."
          : a.beats < 20
            ? "Not saved: too few beats came through. Check the strap is on and connected, then measure again."
            : `Not saved: ${a.skipped} of ${a.beats} beats were skipped. Wet the electrodes, keep still, and measure again.`;
  return <Text style={[s.result, { color: outcome === "saved" || outcome === "kept" ? color.body : outcome === "simulated" ? color.synthetic : color.below }]}>{text}</Text>;
}

function Fig({ label, value, unit, big }: { label: string; value: string; unit: string; big?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.small}>{label}</Text>
      <Text style={[s.figValue, big && { fontSize: 44, letterSpacing: -1 }]}>
        {value}
        <Text style={s.figUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

function Button({ label, onPress, quiet }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.button, quiet && s.quiet, pressed && { opacity: 0.6 }]}>
      <Text style={[s.buttonText, quiet && { color: color.text }]}>{label}</Text>
    </Pressable>
  );
}

function Link({ label, onPress, tint }: { label: string; onPress: () => void; tint?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={[s.link, tint ? { color: tint } : null]}>{label}</Text>
    </Pressable>
  );
}

/** Each interval between beats, in ms, as it arrived; skipped ones as red dots. */
function Trace({ beats, flags, height = 110 }: { beats: Beat[]; flags?: boolean[]; height?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const f = flags ?? analyse(beats).flags;
  const kept = beats.filter((_, i) => !f[i]).map((b) => b.rr);
  if (beats.length < 2 || kept.length < 2 || !w) return <View style={{ height }} onLayout={onLayout} />;
  const lo = Math.min(...kept);
  const hi = Math.max(...kept);
  const pad = Math.max((hi - lo) * 0.15, 20);
  const y = (v: number) => 4 + (1 - (Math.min(Math.max(v, lo - pad), hi + pad) - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 8);
  const x = (i: number) => (i / (beats.length - 1)) * w;
  let d = "";
  let pen = false;
  beats.forEach((b, i) => {
    if (f[i] || b.gap) {
      pen = false;
      if (f[i]) return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(b.rr).toFixed(1)}`;
    pen = true;
  });
  return (
    <View onLayout={onLayout}>
      <Svg width={w} height={height}>
        <Path d={d} stroke={color.body} strokeWidth={1.6} fill="none" />
        {beats.map((b, i) => (f[i] ? <Circle key={i} cx={x(i)} cy={y(b.rr)} r={3} fill={color.below} /> : null))}
      </Svg>
      <Text style={s.axis}>Time between beats, ms · {Math.round(lo)}–{Math.round(hi)}</Text>
    </View>
  );
}

/** The HRV so far, across the reading: it settles as the beats add up. */
function HrvLine({ points, from, span: length, height = 80 }: { points: { at: number; v: number }[]; from: number; span: number; height?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  // At least HRV_SPAN tall, centred: a figure moving a millisecond or two is settled, and should look it.
  const span = Math.max(hi - lo, HRV_SPAN);
  const base = (lo + hi) / 2 - span / 2;
  const x = (at: number) => Math.min(1, Math.max(0, (at - from) / length)) * w;
  const d = w ? points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${(4 + (1 - (p.v - base) / span) * (height - 8)).toFixed(1)}`).join("") : "";
  return (
    <View onLayout={onLayout}>
      {w ? (
        <Svg width={w} height={height}>
          <Path d={d} stroke={color.text} strokeWidth={1.8} fill="none" />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <Text style={s.axis}>HRV so far · settles as it goes · {Math.round(lo)}–{Math.round(hi)} ms</Text>
    </View>
  );
}

interface Candle {
  k: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Values in time buckets of `ms`, numbered from `origin`: open and close the first and last, high and low the extremes. */
function bucket(points: { at: number; v: number }[], ms: number, origin: number): Candle[] {
  const out: Candle[] = [];
  for (const p of points) {
    const k = Math.floor((p.at - origin) / ms);
    const last = out.at(-1);
    if (last && last.k === k) {
      last.h = Math.max(last.h, p.v);
      last.l = Math.min(last.l, p.v);
      last.c = p.v;
    } else out.push({ k, o: p.v, h: p.v, l: p.v, c: p.v });
  }
  return out;
}

/**
 * Candles drawn in `slots` places from `first`. A candle closing above its open is green, as on a price chart:
 * here, HRV rose over its five seconds.
 */
function CandleChart({
  candles,
  slots,
  first,
  height,
  label,
  minSpan = 0,
}: {
  candles: Candle[];
  slots: number;
  first: number;
  height: number;
  label: (lo: number, hi: number) => string;
  minSpan?: number;
}) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const shown = candles.filter((c) => c.k >= first && c.k < first + slots);
  if (!shown.length || !w) return <View style={{ height: height + 15 }} onLayout={onLayout} />;
  const lo = Math.min(...shown.map((c) => c.l));
  const hi = Math.max(...shown.map((c) => c.h));
  const span = Math.max((hi - lo) * 1.2, 10, minSpan);
  const base = (lo + hi) / 2 - span / 2;
  const y = (v: number) => 4 + (1 - (v - base) / span) * (height - 8);
  const slot = w / slots;
  const body = Math.max(3, slot * 0.6);
  return (
    <View onLayout={onLayout}>
      <Svg width={w} height={height}>
        {shown.map((c) => {
          const x = (c.k - first + 0.5) * slot;
          const tint = c.c >= c.o ? UP : DOWN;
          const top = y(Math.max(c.o, c.c));
          return [
            <SvgLine key={`w${c.k}`} x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={tint} strokeWidth={1.2} />,
            <Rect key={`b${c.k}`} x={x - body / 2} y={top} width={body} height={Math.max(1.5, y(Math.min(c.o, c.c)) - top)} fill={tint} rx={1} />,
          ];
        })}
      </Svg>
      <Text style={s.axis}>{label(lo, hi)}</Text>
    </View>
  );
}

const CANDLE_MS = 5000;
/** The HRV charts' least height, ms. */
const HRV_SPAN = 20;

/** The HRV so far, as twelve candles across the reading: five seconds each for a minute, longer for longer. */
function HrvCandles({ points, from, span: length, height = 80 }: { points: { at: number; v: number }[]; from: number; span: number; height?: number }) {
  const ms = Math.max(CANDLE_MS, Math.round(length / 12 / CANDLE_MS) * CANDLE_MS);
  return (
    <CandleChart
      candles={bucket(points, ms, from)}
      slots={Math.ceil(length / ms)}
      first={0}
      height={height}
      label={(lo, hi) => `HRV so far · ${ms / 1000}-second candles · ${Math.round(lo)}–${Math.round(hi)} ms`}
      minSpan={HRV_SPAN}
    />
  );
}

const s = StyleSheet.create({
  content: { gap: space.l, padding: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  figs: { flexDirection: "row", gap: space.s, alignItems: "flex-end" },
  figValue: { fontSize: 22, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figUnit: { fontSize: 14, fontWeight: "400", color: color.muted, letterSpacing: 0 },
  track: { height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: "hidden" },
  fill: { height: 6, backgroundColor: color.body },
  box: { backgroundColor: color.surface, borderRadius: 12, padding: space.m, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  boxText: { fontSize: 14, lineHeight: 20, color: color.muted, flexShrink: 1 },
  device: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  deviceName: { fontSize: 15, fontWeight: "600", color: color.text },
  deviceUse: { fontSize: 14, fontWeight: "600", color: color.body },
  link: { fontSize: 14, fontWeight: "600", color: color.body },
  result: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  button: { flex: 1, backgroundColor: color.body, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  quiet: { backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth, borderColor: color.muted },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  axis: { fontSize: 11, color: color.faint, marginTop: 2 },
  setRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  setLabel: { fontSize: 14, fontWeight: "600", color: color.text },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.m },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: color.muted, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: color.text, lineHeight: 20 },
  stepValue: { fontSize: 15, fontWeight: "600", color: color.text, minWidth: 54, textAlign: "center", fontVariant: ["tabular-nums"] },
  note: { gap: space.xs, borderLeftWidth: 2, borderColor: color.body, paddingLeft: space.m },
  noteTitle: { fontSize: 15, fontWeight: "600", color: color.text },
  noteText: { fontSize: 14, lineHeight: 20, color: color.muted },
});
