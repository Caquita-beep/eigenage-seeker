import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { say, SHORT } from "../answers";
import { useExposure } from "../data";
import type { Answer } from "../exposure";
import { color, space, type } from "../theme";

const LINK: Record<string, string> = {
  "market→body": "Market → body",
  "body→behaviour": "Body → trading",
  "behaviour→body": "Trading → body",
  "market→behaviour": "Market → trading",
};

export default function Exposure() {
  const { answers, progress } = useExposure();
  if (!answers) {
    return (
      <View style={[s.screen, { alignItems: "center", justifyContent: "center", gap: space.m }]}>
        <ActivityIndicator color={color.body} />
        <Text style={type.small}>{progress ? `Asking the questions · ${progress[0]} of ${progress[1]}` : "Waiting for the market"}</Text>
      </View>
    );
  }
  const primary = answers.filter((a) => a.h.tier === "primary");
  const rest = answers.filter((a) => a.h.tier !== "primary");
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={[type.small, { color: color.muted }]}>
        Each question was written down before any data was seen. The three primary ones share a 5% error budget, so their intervals are
        98.3%; the rest are exploratory at 95% and are never worded as findings. Weekly questions carry a trend, so months of drift are not
        read as an effect; nightly ones remove the weekly cycle. Market fear is held fixed wherever trading is on one side.
      </Text>
      <Text style={type.label}>Primary</Text>
      {primary.map((a) => (
        <Card key={a.h.id} a={a} />
      ))}
      <Text style={type.label}>Exploratory</Text>
      {rest.map((a) => (
        <Card key={a.h.id} a={a} />
      ))}
    </ScrollView>
  );
}

function Card({ a }: { a: Answer }) {
  const said = say(a);
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.link}>{LINK[a.h.link]}</Text>
        <Text style={s.link}>{a.h.grain === "week" ? "Weekly" : "Nightly"}</Text>
      </View>
      <Text style={s.title}>{SHORT[a.h.id] ?? a.h.id}</Text>
      <Text style={[type.small, { color: color.muted }]}>{a.h.question}</Text>
      <Text style={[s.status, { color: said.tint }]}>{said.status}</Text>
      {said.detail ? <Text style={[type.small, { color: color.faint }]}>{said.detail}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.l, gap: space.m, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 14, padding: space.l, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", justifyContent: "space-between" },
  link: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8, color: color.faint, textTransform: "uppercase" },
  title: { fontSize: 16, fontWeight: "600", color: color.text },
  status: { fontSize: 15, fontWeight: "600", marginTop: 2 },
});
