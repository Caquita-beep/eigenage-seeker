import { Stack } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { bodyDetail } from "../bodyread";
import { useBody } from "../data";
import type { Response } from "../engine/hrv";
import { BODY, TONE_COLOR } from "../insight";
import { color, space, type } from "../theme";

const LEGEND: { r: Response; hrv: string; cv: string; rhr: string }[] = [
  { r: "coping", hrv: "↑ / →", cv: "↓ / →", rhr: "↓ / →" },
  { r: "stable", hrv: "→", cv: "→", rhr: "→ / ↑" },
  { r: "acute", hrv: "↑ / →", cv: "↑", rhr: "any" },
  { r: "maladaptation", hrv: "↓", cv: "↑", rhr: "often ↑" },
  { r: "fatigue", hrv: "↓", cv: "↓ / →", rhr: "often ↑" },
];

/** How the Body tab's assessment is read: the method, kept off the tab itself. */
export default function Assessment() {
  const { body } = useBody();
  const d = useMemo(() => (body ? bodyDetail(body) : null), [body]);
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "How it's read" }} />
      <View style={s.card}>
        <View style={s.head}>
          <Text style={[s.name, { flex: 1 }]} />
          <Text style={s.col}>HRV</Text>
          <Text style={s.col}>CV</Text>
          <Text style={s.col}>RHR</Text>
        </View>
        {LEGEND.map((l) => (
          <View key={l.r} style={[s.row, d?.response === l.r && s.on]}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR[BODY[l.r].tone] }]} />
              <Text style={s.name}>{BODY[l.r].state}</Text>
            </View>
            <Text style={s.col}>{l.hrv}</Text>
            <Text style={s.col}>{l.cv}</Text>
            <Text style={s.col}>{l.rhr}</Text>
          </View>
        ))}
        <Text style={s.caption}>↑ above your normal · ↓ below · → within. "Any" does not decide it. Yours today is highlighted.</Text>
      </View>
      <View style={{ gap: space.m, paddingHorizontal: space.xs }}>
        <P k="HRV">The 7-day average of your nightly HRV (rMSSD), against your normal: the 60 days before, ±1 standard deviation.</P>
        <P k="CV">How much HRV moved from night to night over 7 days. Up: an acute stressor. Down with HRV below normal: fatigue, not calm.</P>
        <P k="Resting HR">The 7-day average against its own normal. Up with HRV down: the body under strain.</P>
        <P k="One night">A single low night is mostly noise. A 7-day average that leaves its range is not.</P>
      </View>
    </ScrollView>
  );
}

function P({ k, children }: { k: string; children: string }) {
  return (
    <Text style={[type.small, { color: color.muted }]}>
      <Text style={{ color: color.text, fontWeight: "700" }}>{k}. </Text>
      {children}
    </Text>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", paddingHorizontal: space.s, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: space.s, borderRadius: 10 },
  on: { backgroundColor: color.raised },
  dot: { width: 9, height: 9, borderRadius: 5 },
  name: { fontSize: 14.5, fontWeight: "600", color: color.text },
  col: { width: 58, textAlign: "center", fontSize: 13.5, color: color.muted },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint, paddingTop: space.s },
});
