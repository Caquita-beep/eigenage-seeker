import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, space, type } from "../theme";

/**
 * How to breathe, and what it does and does not do, each with its reason.
 * When, and how long, follows the assessment (`breathadvice.ts`), shown on
 * Breathe (`breathe.tsx`).
 */

const POINTS: { title: string; why: string }[] = [
  {
    title: "After the morning reading, never before",
    why: "Slow breathing lifts HRV for a while after you stop. Breathe first and the reading shows the exercise, not your morning.",
  },
  {
    title: "Slow: about six breaths a minute",
    why: "The pace does most of the work. Resonance, at 5.5, is the best studied: near the pace at which heart rate swings most with the breath. Long exhale and Sigh are about as slow; Box and 4-7-8 are slower, with holds, and less studied.",
  },
  {
    title: "Gently, through the nose, into the belly",
    why: "Slow, not big. Breathing deeper than is comfortable blows off carbon dioxide and makes you light-headed. Let the belly rise and the shoulders stay still, and breathe out through the nose or pursed lips.",
  },
  {
    title: "Ten minutes a day, as practice",
    why: "Practised daily for weeks, slow breathing lowers stress and anxiety, and the pace becomes easy to find when you need it. Whether it raises your resting HRV for good is less certain.",
  },
  {
    title: "Before you trade, and after a loss",
    why: "Five slow minutes bring heart rate and arousal down for a while. Take them before a decision, not in the middle of one: on a stressed day, before the session, and after a loss, before the next trade.",
  },
  {
    title: "Before bed, when run down",
    why: "Fatigue is put right by rest and sleep. Fifteen slow minutes before bed can help you fall asleep and sleep better.",
  },
  {
    title: "The live HRV is not recovery",
    why: "HRV jumps while you breathe slowly because the breath swings your heart rate. That is the exercise working, not your body recovered: the morning reading tells you that, and the assessment does not change with a session.",
  },
];

export default function Breathing() {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "How to breathe" }} />
      <View style={s.card}>
        {POINTS.map((x, i) => (
          <View key={x.title} style={[s.point, i > 0 && s.divider]}>
            <View style={s.num}>
              <Text style={s.numText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.title}>{x.title}</Text>
              <Text style={[type.small, { color: color.muted }]}>{x.why}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: color.faint, paddingHorizontal: space.xs }]}>
        Light-headed, tingling or short of breath: stop and breathe normally. With a heart or lung condition, or pregnant, ask your doctor before long holds.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, paddingHorizontal: space.l, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  point: { flexDirection: "row", gap: space.m, paddingVertical: space.m },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: color.body, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { fontSize: 12, fontWeight: "700", color: color.body, fontVariant: ["tabular-nums"] },
  title: { fontSize: 15, fontWeight: "600", color: color.text },
});
