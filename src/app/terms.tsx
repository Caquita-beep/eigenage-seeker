import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { TONE_COLOR } from "../insight";
import { color, space, type } from "../theme";

/**
 * How Insights are read: every word the cards group by, in one place, so the
 * cards themselves carry only numbers and short labels (`sportcards.tsx`).
 */

const SECTIONS: { title: string; terms: { k: string; v: string; tint?: string }[] }[] = [
  {
    title: "Results",
    terms: [
      { k: "Next day", v: "How a trade's coin moved in the 24 hours after it, in your favour (+) or against you (−). Averaged over trades." },
    ],
  },
  {
    title: "Intensity",
    terms: [
      { k: "Easy", v: "A trading day with none of the three strains.", tint: TONE_COLOR.good },
      { k: "Moderate", v: "One strain.", tint: TONE_COLOR.watch },
      { k: "Hard", v: "Two or three strains.", tint: TONE_COLOR.bad },
      { k: "Rest", v: "No trades.", tint: color.faint },
      { k: "Big size", v: "Twice your usual trading day (the median of the last 90 days)." },
      { k: "Late", v: "On-chain past midnight: anything signed between midnight and 5 am." },
      { k: "Big SOL move", v: "SOL moved twice its usual amount that day." },
      { k: "Previous 7 days", v: "Heavier when you moved 1.5× your average week of the 4 weeks before." },
    ],
  },
  {
    title: "Load",
    terms: [
      { k: "Load", v: "The share of your wallet (SOL and stablecoins) you swapped." },
      { k: "Heavier", v: "1.5× the 4 weeks before, or more. Lighter: two thirds or less." },
    ],
  },
  {
    title: "Body",
    terms: [
      { k: "Steady", v: "That morning's assessment was Coping well or Stable." },
      { k: "Strained", v: "Acute stress, Maladaptation or Accumulated fatigue." },
      { k: "HRV", v: "Recorded while you sleep, shown the next morning. A day is paired with the next morning's HRV." },
    ],
  },
  {
    title: "Market",
    terms: [
      { k: "Fear, greed", v: "The Fear & Greed index that day: fear under 45, greed over 55. Days in between are left out." },
    ],
  },
];

export default function Terms() {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "How Insights are read" }} />
      {SECTIONS.map((sec) => (
        <View key={sec.title} style={s.card}>
          <Text style={type.label}>{sec.title}</Text>
          {sec.terms.map((t) => (
            <View key={t.k} style={s.row}>
              <View style={s.key}>
                {t.tint ? <View style={[s.swatch, { backgroundColor: t.tint }]} /> : null}
                <Text style={s.k}>{t.k}</Text>
              </View>
              <Text style={s.v}>{t.v}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { flexDirection: "row", gap: space.m, paddingVertical: 2 },
  key: { width: 112, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingTop: 1 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  k: { fontSize: 14, fontWeight: "700", color: color.text },
  v: { flex: 1, fontSize: 14, lineHeight: 20, color: color.muted },
});
