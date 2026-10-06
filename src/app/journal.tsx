import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { JournalCalendar } from "../journalcalendar";
import { overview, signed, useJournal } from "../journalread";
import { color, space, type } from "../theme";

/** The journal as a calendar, month by month, under its running totals. */
export default function JournalScreen() {
  const { journal: j } = useJournal();
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
      <View style={s.card}>{j ? <JournalCalendar j={j} /> : <Text style={type.small}>Connect a wallet, or load synthetic trades, on the Wallet tab.</Text>}</View>
      <Text style={s.caption}>Realised: each sale against the cost of the oldest coins it sold. Tap a day for its trades, a week for its summary.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.m, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, paddingHorizontal: space.l, paddingVertical: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
});
