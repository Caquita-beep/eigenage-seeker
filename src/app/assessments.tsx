import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { readBody } from "../bodyview";
import { responses } from "../bodyread";
import { dayMs } from "../candles";
import { BODY_INDICATORS, bodyPaneOn, layerTabs, overlays } from "../details/body";
import { useBody, useMarket, useWalletData } from "../data";
import type { Response } from "../engine/hrv";
import { addDays } from "../engine/nights";
import { BODY, TONE_COLOR } from "../insight";
import { useRealised } from "../journalread";
import { toggled, usePref } from "../prefs";
import { ProChart, Tabs, type Pane } from "../prochart";
import { color, space, type } from "../theme";

/**
 * Every morning's assessment, as a chart: a bar a morning, taller the better
 * the body's state, in its colour. Under it, on the same days, whatever is
 * chosen: the body signals it was read from (that morning's, the 7 nights
 * before it), the market, the trading load, and realised P&L, so the money
 * made on each kind of morning is there to see.
 */

/** Each state's height on the chart, best at the top. */
const LANE: Record<Response, number> = { coping: 5, stable: 4, acute: 3, maladaptation: 2, fatigue: 1 };
const ORDER: Response[] = ["coping", "stable", "acute", "maladaptation", "fatigue"];
const NAME: Record<number, string> = Object.fromEntries(ORDER.map((r) => [LANE[r], BODY[r].state]));
/** Short enough for the chart's axis; the key under the chart and the crosshair give the full names. */
const SHORT: Record<Response, string> = { coping: "Coping", stable: "Stable", acute: "Acute", maladaptation: "Maladapt.", fatigue: "Fatigue" };

const PRESETS = [
  { label: "1M", count: 30 },
  { label: "3M", count: 91 },
  { label: "6M", count: 182 },
  { label: "1Y", count: 365 },
  { label: "All", count: 100_000 },
];

const BODY_TAB = (id: string) => `body:${id}`;

const ABOUT =
  "Each bar is the assessment you woke to that morning, read from the 7 days before it; the taller, the better the body's state. Under it, on the same days: the body signals it was read from, as they stood that morning, and that day's market, trading load and realised P&L.";

export default function Assessments() {
  const { body } = useBody();
  const { view: market } = useMarket();
  const { view: wallet } = useWalletData();
  const realised = useRealised();
  // Trading load and P&L by default: what each kind of morning went on to do, and make.
  const [onList, setOn] = usePref<string[]>("assessments:layers", ["load", "pnl"]);
  const on = useMemo(() => new Set(onList), [onList]);
  const [touching, setTouching] = useState(false);
  const read = useMemo(() => (body ? readBody(body) : null), [body]);

  // Mornings, each named by its day: the assessment woken to (the night before's), and that day's market and trading.
  const chart = useMemo(() => {
    if (!body) return null;
    const by = responses(body);
    const nights = [...by.keys()].sort();
    if (!nights.length) return null;
    const days: string[] = [];
    for (let d = addDays(nights[0], 1); d <= addDays(nights[nights.length - 1], 1); d = addDays(d, 1)) days.push(d);
    const rs = days.map((d) => by.get(addDays(d, -1)) ?? null);
    const main: Pane = {
      key: "main",
      height: 150,
      lines: [
        {
          key: "state",
          label: "Assessment",
          values: rs.map((r) => (r ? LANE[r] : null)),
          color: color.muted,
          kind: "bars",
          barWidth: 0.45,
          barColors: rs.map((r) => (r ? TONE_COLOR[BODY[r].tone] : color.muted)),
        },
      ],
      domain: [0, 5.3],
      ticks: ORDER.map((r) => ({ value: LANE[r], label: SHORT[r] })),
      format: (v) => NAME[Math.round(v)] ?? "",
    };
    const subs: Pane[] = [];
    if (read) {
      const before = days.map((d) => addDays(d, -1));
      for (const b of BODY_INDICATORS) if (b.has(body) && on.has(BODY_TAB(b.id))) subs.push(bodyPaneOn(b.id, body, read, before, 80));
    }
    subs.push(...overlays(days, market, wallet, on, realised));
    const last = rs.findLast((r) => r !== null) ?? null;
    const recent = rs.slice(-30).filter((r): r is Response => r !== null);
    const steady = recent.filter((r) => BODY[r].tone === "good").length;
    return { t: days.map(dayMs), main, subs, last, steady, strained: recent.length - steady };
  }, [body, read, market, wallet, realised, on]);

  if (!body || !chart) {
    return (
      <View style={s.empty}>
        <Stack.Screen options={{ title: "Assessments" }} />
        <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>No assessments yet: the first comes after a week of readings.</Text>
      </View>
    );
  }

  const tabs = [
    ...BODY_INDICATORS.filter((b) => b.has(body)).map((b) => ({ key: BODY_TAB(b.id), label: b.label })),
    ...layerTabs(wallet, realised).map((x, i) => ({ ...x, sep: i === 0 })),
  ];
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Assessments" }} />
      <View style={[s.pad, { gap: 4 }]}>
        <Text style={[s.value, chart.last && { color: TONE_COLOR[BODY[chart.last].tone] }]}>{chart.last ? BODY[chart.last].state : "–"}</Text>
        <Text style={type.small}>
          Last 30 mornings: {chart.steady} steady, {chart.strained} strained
        </Text>
      </View>
      <View style={s.chart}>
        <ProChart t={chart.t} main={chart.main} subs={chart.subs} time="daily" presets={PRESETS} persist="assessments" onInteraction={setTouching} />
      </View>
      <View style={s.tabs}>
        <Text style={[type.label, { paddingHorizontal: space.s, paddingTop: space.xs }]}>Lay underneath</Text>
        <Tabs items={tabs} on={(k) => on.has(k)} onPress={(k) => setOn((prev) => toggled(prev, k))} />
      </View>
      <View style={[s.pad, s.key]}>
        {ORDER.map((r) => (
          <View key={r} style={s.keyItem}>
            <View style={[s.swatch, { backgroundColor: TONE_COLOR[BODY[r].tone], height: 4 + 2 * LANE[r] }]} />
            <Text style={s.keyText}>{BODY[r].state}</Text>
          </View>
        ))}
      </View>
      <View style={[s.pad, { gap: space.m }]}>
        <Text style={[type.small, { color: color.muted }]}>{ABOUT}</Text>
        <Pressable onPress={() => router.push("/assessment" as never)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
          <Text style={s.how}>{"How it's read ›"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { paddingBottom: space.xxl, gap: space.m, paddingTop: space.s },
  pad: { paddingHorizontal: space.l },
  empty: { flex: 1, backgroundColor: color.bg, justifyContent: "center", padding: space.xl },
  value: { fontSize: 28, fontWeight: "700", color: color.text },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  tabs: { paddingHorizontal: space.s },
  key: { flexDirection: "row", flexWrap: "wrap", columnGap: space.l, rowGap: 6 },
  keyItem: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  swatch: { width: 8, borderRadius: 2 },
  keyText: { fontSize: 13, color: color.muted },
  how: { fontSize: 14, fontWeight: "600", color: color.muted },
});
