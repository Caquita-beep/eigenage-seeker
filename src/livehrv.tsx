import { useReducer, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { analyse, recent, type Beat } from "./rr";
import { openSettings, useStrap, type Packet, type StrapState } from "./strap";
import { color, space, type } from "./theme";

/**
 * HRV live while breathing (`app/breathe.tsx`), from the strap: rMSSD over
 * the last minute as it changes, against the first minute's. Paced breathing
 * lifts it while it lasts, which is what there is to see here. An exercise,
 * not a reading: nothing is saved (`readings.ts` keeps the readings).
 *
 * `epoch` starts the session again, as a new pattern does.
 */

const WINDOW_MS = 60_000;
/** Beats kept: the window, with room. */
const KEEP_MS = 2 * WINDOW_MS;
/** The chart's least height, ms: a figure moving a millisecond or two is steady, and should look it. */
const SPAN = 20;

interface Live {
  epoch: number;
  beats: Beat[];
  /** The last minute's HRV, at each packet. */
  trace: { at: number; v: number }[];
  hr: number | null;
  contact: boolean | null;
  from: number | null;
}

const empty = (epoch: number): Live => ({ epoch, beats: [], trace: [], hr: null, contact: null, from: null });

function reduce(st: Live, { p, epoch }: { p: Packet; epoch: number }): Live {
  const was = st.epoch === epoch ? st : empty(epoch);
  const beats = recent([...was.beats, ...p.rr.map((rr, i) => ({ rr, gap: i === 0 && p.gap }))], KEEP_MS);
  const v = analyse(recent(beats, WINDOW_MS)).rmssd;
  return { epoch, beats, trace: v === null ? was.trace : [...was.trace, { at: p.at, v }], hr: p.hr || null, contact: p.contact, from: was.from ?? p.at };
}

export function LiveHrv({ epoch }: { epoch: number }) {
  const [st, dispatch] = useReducer(reduce, epoch, empty);
  const { state, connect, retry } = useStrap((p) => dispatch({ p, epoch }));
  // Until the new pattern's first beats, nothing of the last one shows.
  const live = st.epoch === epoch ? st : empty(epoch);

  if (state.kind !== "connected") return <Status state={state} connect={connect} retry={retry} />;

  const now = live.trace.at(-1)?.v ?? null;
  // The first full minute: where the session started from.
  const first = live.from === null ? null : (live.trace.find((x) => x.at - live.from! >= WINDOW_MS)?.v ?? null);
  return (
    <View style={s.card}>
      <View style={s.figs}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.label}>HRV · last minute</Text>
          <Text style={s.value}>
            {now !== null ? now.toFixed(0) : "–"}
            <Text style={s.unit}> ms</Text>
          </Text>
          <Text style={type.small}>{first !== null ? `First minute ${first.toFixed(0)} ms` : "Steadies over the first minute"}</Text>
        </View>
        <View style={{ gap: 2, alignItems: "flex-end" }}>
          <Text style={type.label}>Heart rate</Text>
          <Text style={s.value}>
            {live.hr ?? "–"}
            <Text style={s.unit}> bpm</Text>
          </Text>
        </View>
      </View>
      {live.trace.length > 1 ? <Trail points={live.trace} /> : null}
      {live.contact === false ? <Text style={[type.small, { color: color.below }]}>No skin contact. Wet the electrodes and tighten the strap.</Text> : null}
      <Text style={[type.small, { color: color.faint }]}>
        {state.strap.name}. An exercise, not a reading: nothing is saved.
      </Text>
    </View>
  );
}

/** Before the strap is connected: one quiet line, and what can be done about it. */
function Status({ state, connect, retry }: { state: StrapState; connect: (s: { id: string; name: string }) => void; retry: () => void }) {
  switch (state.kind) {
    case "starting":
    case "unsupported":
      return null;
    case "off":
      return <Line text="Bluetooth is off. Turn it on for live HRV." action={{ label: "Try again", onPress: retry }} />;
    case "denied":
      return <Line text="Live HRV needs the Nearby devices permission." action={{ label: "Open settings", onPress: openSettings }} />;
    case "connecting":
      return <Line text={`Connecting to ${state.strap.name}…`} busy />;
    case "lost":
      return <Line text={`Lost ${state.strap.name}.`} action={{ label: "Try again", onPress: retry }} />;
    case "scanning":
      return (
        <View style={{ gap: space.s }}>
          <Line text="Looking for your strap, for live HRV." busy />
          {state.found.map((d) => (
            <Pressable key={d.id} onPress={() => connect(d)} style={({ pressed }) => [s.device, pressed && { opacity: 0.6 }]}>
              <Text style={s.deviceName}>{d.name}</Text>
              <Text style={s.link}>Use ›</Text>
            </Pressable>
          ))}
        </View>
      );
  }
}

function Line({ text, busy, action }: { text: string; busy?: boolean; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.line}>
      {busy ? <ActivityIndicator color={color.body} size="small" /> : null}
      <Text style={[type.small, { flexShrink: 1 }]}>{text}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={s.link}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The last minute's HRV across the session. */
function Trail({ points, height = 64 }: { points: { at: number; v: number }[]; height?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = Math.max(hi - lo, SPAN);
  const base = (lo + hi) / 2 - span / 2;
  const t0 = points[0].at;
  const t1 = Math.max(points.at(-1)!.at, t0 + WINDOW_MS);
  const d = w ? points.map((p, i) => `${i ? "L" : "M"}${(((p.at - t0) / (t1 - t0)) * w).toFixed(1)},${(4 + (1 - (p.v - base) / span) * (height - 8)).toFixed(1)}`).join("") : "";
  return (
    <View onLayout={onLayout}>
      {w ? (
        <Svg width={w} height={height}>
          <Path d={d} stroke={color.body} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <Text style={s.axis}>
        Since you started · {Math.round(lo)}–{Math.round(hi)} ms
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  figs: { flexDirection: "row", alignItems: "flex-start", gap: space.m },
  value: { fontSize: 26, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 14, fontWeight: "400", color: color.muted },
  axis: { fontSize: 11, color: color.faint, marginTop: 2 },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.s },
  link: { fontSize: 14, fontWeight: "600", color: color.body },
  device: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  deviceName: { fontSize: 15, fontWeight: "600", color: color.text },
});
