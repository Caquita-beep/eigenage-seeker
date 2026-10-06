import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useExposure, useMarket } from "./data";
import { TONE_COLOR } from "./insight";
import { notes, periodLabel, periods, signed, story, toneOf, type Journal, type PeriodKind } from "./journalread";
import { color, space, type } from "./theme";

/**
 * The journal as a short list: one row per day, week or month, with its
 * trades, what it realised, and the one line most worth reading — the
 * biggest market day joined to the next morning, else the most telling note.
 * Each row opens the period's own page. `compact` leaves the line out.
 */
export function JournalList({ j, kind, limit, compact }: { j: Journal; kind: PeriodKind; limit?: number; compact?: boolean }) {
  const { view: market } = useMarket();
  const { data } = useExposure();
  const list = periods(j.ledger.fills, kind).slice(0, limit ?? 1000);
  if (!list.length) return <Text style={[type.small, { color: color.muted }]}>No trades yet.</Text>;
  return (
    <View>
      {list.map((p, k) => {
        const st = story(j, p, market, data);
        const line = st.join ?? notes(j, p)[0] ?? st.body ?? st.market;
        const pnl = Math.abs(p.realised) >= 1 ? signed(p.realised) : "";
        return (
          <Pressable
            key={p.start}
            onPress={() => router.push(`/period?kind=${kind}&start=${p.start}` as never)}
            style={({ pressed }) => [s.row, k > 0 && s.divider, pressed && { opacity: 0.6 }]}
          >
            <View style={s.head}>
              <Text style={s.title}>{periodLabel(p, kind)}</Text>
              <Text style={s.trades}>
                {p.fills.length} trade{p.fills.length === 1 ? "" : "s"}
              </Text>
              <Text style={[s.pnl, { color: pnl ? TONE_COLOR[toneOf(p.realised) === "bad" ? "bad" : "good"] : color.faint }]}>{pnl || "–"}</Text>
            </View>
            {line && !compact ? (
              <Text style={[s.line, st.join && line === st.join ? { color: TONE_COLOR.watch } : null]} numberOfLines={2}>
                {line}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: space.s + 2, gap: 3 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", alignItems: "baseline", gap: space.s },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: color.text },
  trades: { fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  pnl: { width: 64, textAlign: "right", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  line: { fontSize: 13, lineHeight: 18, color: color.muted },
});
