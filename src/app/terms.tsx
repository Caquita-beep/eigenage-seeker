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
      { k: "P&L", v: "Realised P&L: what your sells made over what the coins cost, first in, first out, in dollars, on the day of the sell (05:00 to 05:00). A day with no sell has none. A day: a side's P&L over its days." },
      { k: "Best, worst", v: "Only from a condition whose two sides differ beyond chance, the six conditions sharing a 5% chance of a false alarm. Bold: such a condition." },
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
      { k: "HRV", v: "Recorded while you sleep, or in a one-minute reading on waking. A day is paired with the next morning's HRV." },
      {
        k: "Morning reading",
        v: "One minute of heartbeats on waking, sitting still, from a chest strap. rMSSD is computed on this phone from the time between beats; a beat more than 20% off its neighbours is skipped.",
      },
    ],
  },
  {
    title: "Correlations",
    terms: [
      { k: "Correlation", v: "How two things rise and fall together, from −1 to +1, by rank (Spearman), so one huge day does not set it. Near 0: no relation." },
      { k: "Shaded band", v: "What chance alone gives for that many days, allowing for days that run in streaks and for how many factors are checked. Only a factor beyond it is bold." },
      { k: "HRV, against your normal", v: "That morning's HRV minus your 60-day average, so seasons and fitness do not show up as a correlation." },
      { k: "On days you traded", v: "Moved, size and trades count trading days only: how much, when you traded." },
      { k: "P&L, on days you sold", v: "As an outcome, days with a sell only. As a factor, the day's P&L against the sleep after it, and the day before's against the next day's trading." },
      { k: "Not proof", v: "Nothing else is held fixed. The Questions are the tests." },
      { k: "Question", v: "Written down before your data was seen, and tested with the market's day held fixed; a question about HRV also holds your HRV the morning before. A run of days in a row counts as one piece of evidence, not one per day. The Questions tab lists them all, most important first." },
      { k: "Below-normal morning", v: "In the Questions: HRV's 7-day average under your 60-day normal by more than half a standard deviation, as the questions were written. The Body tab's normal range is wider, ±1 standard deviation." },
      { k: "Pressure", v: "How much you are under, 0 to 100, from your body, your positions and the market, each against your own normal. Its page is on the Pressure question." },
      { k: "Found", v: "A main question whose interval excludes zero. The main ones share a 5% chance of a false alarm." },
      { k: "Hint", v: "An exploratory question that came out clearly. A hint until confirmed." },
      { k: "Two-way", v: "Linked in both directions, so something else probably drives both. Not counted." },
      { k: "Learning", v: "Not enough days yet, or too few on one side." },
    ],
  },
  {
    title: "Moon",
    terms: [
      { k: "Moonlight", v: "The share of the moon lit that night, worked out from the date." },
      { k: "Near full, near new", v: "Three quarters lit or more; a quarter or less. Half-moons are left out." },
      { k: "Why it is here", v: "Studies on the moon and sleep or markets disagree, and the effects found are small. Your own data decides, under the same chance band as everything else." },
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
