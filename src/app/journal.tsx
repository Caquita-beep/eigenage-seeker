import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { JournalList } from "../journallist";
import { overview, signed, useJournal, type PeriodKind } from "../journalread";
import { oneOf, usePref } from "../prefs";
import { color, space, type } from "../theme";
import { ResToggle } from "../ui";

/** The whole journal, newest first: Today shows the last few; this shows them all. */
export default function JournalScreen() {
  const { journal: j } = useJournal();
  const [kindRaw, setKind] = usePref<PeriodKind>("journal:period", "week");
  const kind = oneOf(kindRaw, ["day", "week", "month"], "week");
  const ov = j ? overview(j) : null;
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Journal" }} />
      {ov ? (
        <Text style={type.small}>
          {signed(ov.realised)} realised{ov.open ? ` · open positions ${signed(ov.open.value - ov.open.cost)}` : ""}
          {ov.winRate !== null ? ` · ${Math.round(100 * ov.winRate)}% of sales made money` : ""}
        </Text>
      ) : null}
      <ResToggle
        options={[
          { key: "day", label: "Day" },
          { key: "week", label: "Week" },
          { key: "month", label: "Month" },
        ]}
        value={kind}
        onChange={setKind}
      />
      <View style={s.card}>{j ? <JournalList j={j} kind={kind} /> : <Text style={type.small}>Connect a wallet, or load synthetic trades, on the Wallet tab.</Text>}</View>
      <Text style={s.caption}>Realised: each sale against the cost of the oldest coins it sold. Tap a row for its trades, day by day.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.m, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, paddingHorizontal: space.l, paddingVertical: space.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
});
