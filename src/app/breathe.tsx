import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { patternOf, perMinute, PATTERNS, rhythm, shapePath, type Pattern } from "../breath";
import { breathAdvice } from "../breathadvice";
import { Breather, LOOKS, type Look } from "../breather";
import { bodyDetail } from "../bodyread";
import { useBody } from "../data";
import { BODY } from "../insight";
import { LiveHrv } from "../livehrv";
import { usePref } from "../prefs";
import { thisMorning } from "../readings";
import { remembered } from "../strap";
import { color, space, type } from "../theme";
import { ResToggle } from "../ui";

/**
 * Breathing, the exercise, with the guide (`breather.tsx`): for as long as
 * the screen is open. The patterns are a list, each with the shape of its
 * breath; the one chosen is remembered. With the strap on, HRV shows live
 * (`livehrv.tsx`); no strap is needed. What the assessment suggests doing
 * with it today (`breathadvice.ts`) sets the time to reach, and why is said
 * under the guide; how to breathe is one tap on (`breathing.tsx`).
 */
export default function Breathe() {
  useKeepAwake();
  const { width } = useWindowDimensions();
  const [id, setId] = usePref<string>("breathe:pattern", "resonance");
  // The guide's look, shared with the reading screen's.
  const [look, setLook] = usePref<Look>("breathe:look", "hexagon");
  const pattern = patternOf(id) ?? PATTERNS[0];
  const size = Math.min(width - 2 * space.xxl, 280);
  const { body, readings } = useBody();
  const response = useMemo(() => (body ? bodyDetail(body).response : null), [body]);
  const advice = breathAdvice(response);
  // Slow breathing lifts HRV for a while after: the morning reading comes first.
  const due = thisMorning(readings).kind === "due";

  // Each choice starts the guide again, on a breath in, and the time with it.
  const [run, setRun] = useState(0);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [run]);
  // The strap is looked for only when one has been used before, or asked for: no Bluetooth prompt for breathing alone.
  const [strap, setStrap] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    remembered().then((r) => on && setStrap((x) => x ?? r !== null));
    return () => {
      on = false;
    };
  }, []);
  const choose = (next: string) => {
    if (next === pattern.id) return;
    setId(next);
    setRun((r) => r + 1);
    setSec(0);
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.looks}>
        <ResToggle options={LOOKS} value={LOOKS.some((l) => l.key === look) ? look : "hexagon"} onChange={setLook} flush />
      </View>

      <Breather pattern={pattern} size={size} epoch={run} look={look} />

      <View style={s.about}>
        <Text style={s.name}>{pattern.name}</Text>
        <Text style={[s.time, sec >= advice.min * 60 && { color: color.body }]}>
          {clock(sec)}
          {sec >= advice.min * 60 ? ` · ${advice.min} min done` : ` / ${advice.min}:00`}
        </Text>
        <Text style={[type.small, { textAlign: "center" }]}>{pattern.line}</Text>
      </View>

      {due ? (
        <Pressable onPress={() => router.push("/reading" as never)} style={({ pressed }) => [s.due, pressed && { opacity: 0.7 }]}>
          <Text style={[type.small, { flex: 1, color: color.text }]}>Take this morning&apos;s reading first: slow breathing lifts HRV for a while after.</Text>
          <Text style={s.link}>Reading ›</Text>
        </Pressable>
      ) : null}

      <View style={s.live}>
        {strap ? (
          <LiveHrv epoch={run} />
        ) : strap === false ? (
          <Pressable onPress={() => setStrap(true)} hitSlop={8}>
            <Text style={s.connect}>Wearing a strap? See your HRV live ›</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.advice}>
        <Text style={type.label}>{response ? `Today · ${BODY[response].state}` : "Today"}</Text>
        <Text style={s.adviceWhen}>
          {advice.when} · {advice.min} min
          {advice.also ? <Text style={s.adviceAlso}>, {advice.also}</Text> : null}
        </Text>
        <Text style={[type.small, { color: color.muted }]}>{advice.why}</Text>
        <Pressable onPress={() => router.push("/breathing" as never)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
          <Text style={s.link}>How to breathe ›</Text>
        </Pressable>
      </View>

      <View style={s.list}>
        {PATTERNS.map((p) => (
          <PatternRow key={p.id} p={p} on={p.id === pattern.id} onPress={() => choose(p.id)} />
        ))}
      </View>
    </ScrollView>
  );
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** A pattern: the shape of its breath, its name and seconds, and its pace. */
function PatternRow({ p, on, onPress }: { p: Pattern; on: boolean; onPress: () => void }) {
  const shape = useMemo(() => shapePath(p, 52, 22), [p]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, on && s.rowOn, pressed && { opacity: 0.7 }]}>
      <Svg width={52} height={22}>
        <Path d={shape} stroke={on ? color.body : color.faint} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.rowName, on && { color: color.text }]}>{p.name}</Text>
        <Text style={s.rowRhythm}>{rhythm(p)}</Text>
      </View>
      <Text style={[s.rowRate, on && { color: color.body }]}>
        {perMinute(p)}
        <Text style={s.rowUnit}> /min</Text>
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { gap: space.xl, paddingTop: space.l, paddingBottom: space.xxl },
  looks: { alignItems: "center" },
  about: { gap: space.xs, alignItems: "center", paddingHorizontal: space.xl },
  name: { fontSize: 13, fontWeight: "600", letterSpacing: 3, color: color.text, textTransform: "uppercase" },
  time: { fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  list: { gap: space.s, paddingHorizontal: space.l },
  live: { paddingHorizontal: space.l },
  connect: { fontSize: 14, fontWeight: "600", color: color.body, textAlign: "center" },
  link: { fontSize: 14, fontWeight: "600", color: color.body },
  due: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    marginHorizontal: space.l,
    padding: space.m,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.body,
    backgroundColor: color.surface,
  },
  advice: {
    marginHorizontal: space.l,
    padding: space.l,
    gap: space.s,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  adviceWhen: { fontSize: 16, fontWeight: "700", color: color.text },
  adviceAlso: { fontWeight: "400", color: color.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: space.m,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowOn: { borderWidth: 1, borderColor: color.body, backgroundColor: color.raised },
  rowName: { fontSize: 15, fontWeight: "600", color: color.muted },
  rowRhythm: { fontSize: 12, color: color.faint, letterSpacing: 0.3, fontVariant: ["tabular-nums"] },
  rowRate: { fontSize: 15, fontWeight: "600", color: color.muted, fontVariant: ["tabular-nums"] },
  rowUnit: { fontSize: 11, fontWeight: "400", color: color.faint },
});
