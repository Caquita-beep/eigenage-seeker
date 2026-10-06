import { router, Stack } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useExposure, useMarket } from "../data";
import { TONE_COLOR, type Tone } from "../insight";
import { pct0, recapInsights, recaps, signed, toneOf, useJournal } from "../journalread";
import { color, space, type } from "../theme";

const toneColor = (t: Tone) => (t === "neutral" ? color.muted : TONE_COLOR[t]);
const dayName = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/**
 * The Daily recap's history: each day's trading against the reader's usual
 * and the body they woke with, newest first — and, above it, what those days
 * show taken together. Each day opens its trades.
 */
export default function RecapScreen() {
  const { journal: j, wallet } = useJournal();
  const { view: market } = useMarket();
  const { data } = useExposure();
  const list = useMemo(() => (j && wallet ? recaps(j, wallet, market, 60) : []), [j, wallet, market]);
  const insights = useMemo(() => (j ? recapInsights(j, list, data) : []), [j, list, data]);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Daily recap" }} />
      {insights.length ? (
        <View style={s.card}>
          <Text style={type.label}>What your days show</Text>
          {insights.map((x) => (
            <View key={x.text} style={s.insight}>
              <View style={[s.dot, { backgroundColor: toneColor(x.tone) }]} />
              <Text style={[type.body, { flex: 1, color: color.text }]}>{x.text}</Text>
            </View>
          ))}
          <Text style={s.caption}>Counts from your own last 60 days, not tests. The links tested properly are on Insights.</Text>
        </View>
      ) : null}

      <View style={[s.card, { paddingVertical: space.xs }]}>
        {list.map((d, k) => (
          <Pressable
            key={d.night}
            onPress={() => router.push(`/period?kind=day&start=${d.night}` as never)}
            style={({ pressed }) => [s.day, k > 0 && s.divider, pressed && { opacity: 0.6 }]}
          >
            <View style={s.head}>
              <Text style={s.date}>{dayName(d.night)}</Text>
              <Text style={[s.word, { color: toneColor(d.tone) }]}>{d.word}</Text>
            </View>
            <Text style={s.figs}>
              {d.trades} trade{d.trades === 1 ? "" : "s"} · {pct0(d.moved)} of wallet{d.usual !== null ? ` (usual ${pct0(d.usual)})` : ""}
              {Math.abs(d.realised) >= 1 ? <Text style={{ color: toneColor(toneOf(d.realised)) }}> · {signed(d.realised)}</Text> : null}
            </Text>
            {d.body ? <Text style={s.body}>{d.body}</Text> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  insight: { flexDirection: "row", gap: space.s, alignItems: "flex-start" },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 7 },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
  day: { paddingVertical: space.s + 2, gap: 3 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  date: { fontSize: 15, fontWeight: "700", color: color.text },
  word: { fontSize: 13.5, fontWeight: "700" },
  figs: { fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  body: { fontSize: 13.5, lineHeight: 18, color: color.text },
});
