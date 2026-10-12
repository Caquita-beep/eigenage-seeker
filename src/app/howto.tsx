import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, space, type } from "../theme";

/**
 * How to take the morning reading, step by step, each with its reason. The
 * reading screen keeps the short form of it (`reading.tsx`) and does the
 * settling minute itself.
 */

const STEPS: { title: string; why: string }[] = [
  {
    title: "On waking, after the bathroom",
    why: "Before coffee, food, a shower or your phone. A full bladder stirs the stress response and can lower HRV, so go first.",
  },
  {
    title: "Strap on, electrodes wet",
    why: "A little water or gel on the two electrodes, the pads on the strap's inside. Dry, they drop beats, and dropped beats spoil the reading.",
  },
  {
    title: "Sit down",
    why: "Sitting is the easiest to repeat, and you won't doze off. Lying down works too if it is every morning: posture moves HRV more than anything else here. With a very low resting heart rate, as in many endurance athletes, sitting shows changes that lying down can hide.",
  },
  {
    title: "Press Start and keep still",
    why: "The first minute lets your heart settle after getting up, and is not recorded. The minute after it is your reading. Don't talk or move; looking at the screen is fine.",
  },
  {
    title: "Breathe normally",
    why: "As it comes, without trying. Slow, paced breathing lifts HRV while it lasts and blurs one morning against the next, so a reading has no breathing guide. Breathing is an exercise of its own, on Today.",
  },
  {
    title: "Every morning, even the bad ones",
    why: "A short night, a late drink, feeling off: those mornings show something, and skipping them hides it. Seven mornings give a first baseline.",
  },
];

export default function HowTo() {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "How to measure" }} />
      <View style={s.card}>
        {STEPS.map((x, i) => (
          <View key={x.title} style={[s.step, i > 0 && s.divider]}>
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
        Same time, same place, same way. It is the change from one morning to the next that is read, not the number on its own.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, paddingHorizontal: space.l, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  step: { flexDirection: "row", gap: space.m, paddingVertical: space.m },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: color.body, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { fontSize: 12, fontWeight: "700", color: color.body, fontVariant: ["tabular-nums"] },
  title: { fontSize: 15, fontWeight: "600", color: color.text },
});
