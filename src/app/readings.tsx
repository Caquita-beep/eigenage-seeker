import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { patternOf } from "../breath";
import { useBody } from "../data";
import { usePref } from "../prefs";
import { isMorning, MORNING_UNTIL_HOUR, type Reading } from "../readings";
import { color, space, type } from "../theme";
import { ResToggle } from "../ui";

/**
 * Every strap reading, by when it was taken: the mornings, which make the
 * trend, and those at other times, kept apart from it (`readings.ts`).
 *
 *   Over time     each reading at its date and time; the mornings joined.
 *   Time of day   each reading at its hour, the morning window shaded: why
 *                 the two are kept apart, HRV being lower later in the day.
 */

type View_ = "time" | "hour";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hours into the local day, 0–24. */
const hourOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
};

export default function Readings() {
  const { readings, removeReading, removeAllReadings } = useBody();
  const confirmRemove = (r: Reading) =>
    Alert.alert("Delete this reading?", `${when(r)}: ${r.rmssd.toFixed(0)} ms. It is deleted from this phone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void removeReading(r.at) },
    ]);
  const confirmRemoveAll = () =>
    Alert.alert("Delete all readings?", `All ${readings.length}, mornings and other times, are deleted from this phone and cannot be read again.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: () => void removeAllReadings() },
    ]);
  const [view, setView] = usePref<View_>("readings:view", "time");
  const morning = readings.filter(isMorning);
  const other = readings.filter((r) => !isMorning(r));

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Pressable onPress={() => router.push("/reading" as never)} style={({ pressed }) => [s.button, pressed && { opacity: 0.7 }]}>
        <Text style={s.buttonText}>Take a reading</Text>
      </Pressable>

      {readings.length ? (
        <View style={s.card}>
          <ResToggle
            options={[
              { key: "time", label: "Over time" },
              { key: "hour", label: "Time of day" },
            ]}
            value={view}
            onChange={setView}
            flush
          />
          <ReadingsChart readings={readings} view={view} />
          <View style={s.legend}>
            <Key filled label={`Morning · ${morning.length}`} />
            <Key label={`Other times · ${other.length}`} />
          </View>
        </View>
      ) : (
        <Text style={[type.body, { color: color.muted }]}>No readings yet. One minute with your strap, on waking, sitting still.</Text>
      )}

      {morning.length ? <List title="Morning" note="Your HRV trend." readings={morning} onLongPress={confirmRemove} /> : null}
      {other.length ? <List title="Other times" note={`Taken after ${MORNING_UNTIL_HOUR}:00. Kept here, apart from your trend.`} readings={other} onLongPress={confirmRemove} /> : null}
      {readings.length ? (
        <View style={s.foot}>
          <Text style={[type.small, { color: color.faint, flex: 1 }]}>Press and hold a reading to delete it.</Text>
          <Pressable onPress={confirmRemoveAll} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.5 }}>
            <Text style={s.deleteAll}>Delete all</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Key({ label, filled }: { label: string; filled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Svg width={10} height={10}>
        <Circle cx={5} cy={5} r={4} fill={filled ? color.body : "none"} stroke={filled ? "none" : color.muted} strokeWidth={1.5} />
      </Svg>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

function ReadingsChart({ readings, view, height = 170 }: { readings: Reading[]; view: View_; height?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  if (!w) return <View style={{ height: height + 18 }} onLayout={onLayout} />;

  const vs = readings.map((r) => r.rmssd);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, 5);
  const top = 8;
  const bottom = height - 18;
  const y = (v: number) => top + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (bottom - top);
  const left = 6;
  const right = w - 34;

  // Over time: from the first reading's day to the last's, a day either side so a lone reading sits inside.
  const t0 = Math.min(...readings.map((r) => r.at)) - DAY / 2;
  const t1 = Math.max(...readings.map((r) => r.at)) + DAY / 2;
  const x = (r: Reading) => (view === "hour" ? left + (hourOf(r.at) / 24) * (right - left) : left + ((r.at - t0) / (t1 - t0)) * (right - left));

  const morning = readings.filter(isMorning).sort((a, b) => a.at - b.at);
  const line = view === "time" && morning.length > 1 ? morning.map((r, i) => `${i ? "L" : "M"}${x(r).toFixed(1)},${y(r.rmssd).toFixed(1)}`).join("") : "";
  const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const ticks =
    view === "hour"
      ? [0, 6, 12, 18, 24].map((h) => ({ x: left + (h / 24) * (right - left), label: `${h}:00` }))
      : [
          { x: left, label: day(t0 + DAY / 2) },
          { x: right, label: day(t1 - DAY / 2) },
        ];

  return (
    <View onLayout={onLayout}>
      <Svg width={w} height={height}>
        {view === "hour" ? (
          <>
            <Rect x={left} y={top} width={(MORNING_UNTIL_HOUR / 24) * (right - left)} height={bottom - top} fill={color.body} opacity={0.07} />
            <SvgText x={left + 4} y={top + 12} fill={color.body} fontSize={10} opacity={0.8}>
              Morning
            </SvgText>
          </>
        ) : null}
        <SvgText x={w - 2} y={y(hi) + 4} fill={color.faint} fontSize={10} textAnchor="end">
          {Math.round(hi)}
        </SvgText>
        <SvgText x={w - 2} y={y(lo) + 4} fill={color.faint} fontSize={10} textAnchor="end">
          {Math.round(lo)}
        </SvgText>
        {line ? <Path d={line} stroke={color.body} strokeWidth={1.6} fill="none" opacity={0.7} /> : null}
        {readings.map((r) =>
          isMorning(r) ? (
            <Circle key={r.at} cx={x(r)} cy={y(r.rmssd)} r={4} fill={color.body} />
          ) : (
            <Circle key={r.at} cx={x(r)} cy={y(r.rmssd)} r={4} fill={color.bg} stroke={color.muted} strokeWidth={1.6} />
          ),
        )}
        {ticks.map((t, i) => (
          <SvgText key={i} x={t.x} y={height - 4} fill={color.faint} fontSize={10} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}>
            {t.label}
          </SvgText>
        ))}
      </Svg>
      <Text style={s.axis}>HRV, rMSSD in ms{view === "hour" ? ", by the hour it was taken" : ""}</Text>
    </View>
  );
}

const when = (r: Reading) =>
  `${new Date(r.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${new Date(r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

function List({ title, note, readings, onLongPress }: { title: string; note: string; readings: Reading[]; onLongPress: (r: Reading) => void }) {
  return (
    <View style={{ gap: space.s }}>
      <View style={{ gap: 2 }}>
        <Text style={type.label}>{title}</Text>
        <Text style={type.small}>{note}</Text>
      </View>
      <View style={s.card}>
        {[...readings].reverse().map((r, i) => (
          <Pressable key={r.at} onLongPress={() => onLongPress(r)} style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { opacity: 0.6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.when}>{new Date(r.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</Text>
              <Text style={type.small}>
                {new Date(r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {r.hr.toFixed(0)} bpm{r.minutes ? ` · ${r.minutes} min` : ""}
                {patternOf(r.breath) ? ` · ${patternOf(r.breath)!.name}` : ""}{r.skipped ? ` · ${r.skipped} skipped` : ""}
              </Text>
            </View>
            <Text style={s.value}>
              {r.rmssd.toFixed(0)}
              <Text style={s.unit}> ms</Text>
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  content: { gap: space.l, padding: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  legend: { flexDirection: "row", gap: space.l },
  button: { backgroundColor: color.body, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space.s },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  when: { fontSize: 15, fontWeight: "600", color: color.text },
  value: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 13, fontWeight: "400", color: color.muted },
  axis: { fontSize: 11, color: color.faint, marginTop: 2 },
  foot: { flexDirection: "row", alignItems: "center", gap: space.m },
  deleteAll: { fontSize: 13, fontWeight: "600", color: color.below },
});
