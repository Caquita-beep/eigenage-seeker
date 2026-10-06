import { Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { HIGH, RISING, WEIGHTS } from "../engine/pressure";
import { TONE_COLOR, type Tone } from "../insight";
import { LEVEL, SIGNAL, usePressure } from "../pressureread";
import { ProChart, type Pane } from "../prochart";
import { color, space, type } from "../theme";
import { Ring } from "../ui";

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const toneOf = (v: number): Tone => (v >= HIGH ? "bad" : v >= RISING ? "watch" : "good");
const PARTS = [
  { key: "body", name: "Body", color: color.body },
  { key: "positions", name: "Positions", color: color.wallet },
  { key: "market", name: "Market", color: color.market },
] as const;

/**
 * Pressure in full: today's score and what makes it up, every signal with
 * its value in plain units and where it ranks against the reader's own last
 * 90 days, and the last 90 days of it.
 */
export default function PressureScreen() {
  const { days, now } = usePressure();
  const [touching, setTouching] = useState(false);
  if (!now) return <Stack.Screen options={{ title: "Pressure" }} />;
  const lvl = LEVEL[now.level];

  const main: Pane = {
    key: "main",
    height: 200,
    lines: [
      { key: "total", label: "Pressure", values: days.map((d) => d.total), color: color.text, width: 2 },
      ...PARTS.map((p) => ({ key: p.key, label: p.name, values: days.map((d) => d.parts[p.key]), color: p.color, width: 1 })),
    ],
    guides: [RISING, HIGH],
    domain: [0, 100],
    format: (v) => v.toFixed(0),
  };

  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Pressure" }} />
      <View style={[s.pad, s.head]}>
        <Ring pct={now.total} unit="" tint={TONE_COLOR[lvl.tone]} label="" size={88} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[s.word, { color: TONE_COLOR[lvl.tone] }]}>{lvl.word}</Text>
          <Text style={type.small}>
            Body {Math.round(WEIGHTS.body * 100)}% · Positions {Math.round(WEIGHTS.positions * 100)}% · Market {Math.round(WEIGHTS.market * 100)}%
          </Text>
        </View>
      </View>

      <View style={s.chart}>
        <ProChart t={days.map((d) => dayMs(d.night))} main={main} time="daily" initialCount={90} onInteraction={setTouching} />
      </View>

      {PARTS.map((p) => {
        const sig = now.signals.filter((x) => SIGNAL[x.key].part === p.key);
        const v = now.parts[p.key];
        return (
          <View key={p.key} style={[s.card, s.pad2]}>
            <View style={s.partHead}>
              <Text style={type.label}>{p.name}</Text>
              <Text style={[s.partScore, { color: v === null ? color.faint : TONE_COLOR[toneOf(v)] }]}>{v === null ? "–" : Math.round(v)}</Text>
            </View>
            {sig.length ? (
              sig.map((x) => (
                <View key={x.key} style={s.sig}>
                  <Text style={s.sigName}>{SIGNAL[x.key].name}</Text>
                  <Text style={s.sigValue}>{SIGNAL[x.key].value(x.value)}</Text>
                  <View style={s.track}>
                    <View style={[s.fill, { width: `${Math.max(3, x.score)}%`, backgroundColor: TONE_COLOR[toneOf(x.score)] }]} />
                  </View>
                </View>
              ))
            ) : (
              <Text style={[type.small, { color: color.faint }]}>No data yet.</Text>
            )}
          </View>
        );
      })}

      <Text style={[s.caption, s.pad]}>
        0 is an ordinary day for you. Body: 50 at the edge of your normal range, 100 at twice that. Positions: 0 when a signal is absent,
        otherwise ranked against your own bad days in the last 90. Market: 0 at the year's median, 100 at its worst. The total weighs the parts
        40 / 40 / 20, and one extreme part pulls it up. Low under 35, High from 60. Read from your wearable, your wallet and the market alone.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { paddingVertical: space.l, gap: space.l, paddingBottom: space.xxl },
  pad: { paddingHorizontal: space.l },
  pad2: { marginHorizontal: space.l },
  head: { flexDirection: "row", alignItems: "center", gap: space.l },
  word: { fontSize: 26, fontWeight: "700" },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  partHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  partScore: { fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  sig: { flexDirection: "row", alignItems: "center", gap: space.s },
  sigName: { flex: 1, fontSize: 13.5, color: color.text },
  sigValue: { width: 64, textAlign: "right", fontSize: 13.5, color: color.muted, fontVariant: ["tabular-nums"] },
  track: { width: 70, height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
});
