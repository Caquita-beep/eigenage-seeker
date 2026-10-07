import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBody, useExposure } from "../../data";
import { TONE_COLOR } from "../../insight";
import { positionNow, signed, useJournal } from "../../journalread";
import { color, space, type } from "../../theme";
import { ResToggle, Sparkline } from "../../ui";
import { BestCard, CorrCard } from "../../sportcards";
import { useSport } from "../../sportread";
import { oneOf, usePref } from "../../prefs";
import { QuestionList, rankQuestions } from "../../questionlist";

type Tab = "overview" | "correlations" | "questions";

/**
 * Insights, in three sub-tabs (the week's load and intensity are on Today):
 *
 *   Overview       when the reader trades best (results split by the body,
 *                  SOL's moves, the market's mood, the clock, the week coming
 *                  in and the moon), and the coins against what they cost
 *   Correlations   each factor against one outcome at a time (`drivers.ts`)
 *   Questions      every tested question, one closed card each, most
 *                  important first (`questionlist.tsx`)
 */
export default function Insights() {
  const { answers, progress, data } = useExposure();
  const { body } = useBody();
  const { journal: j, wallet } = useJournal();

  const questions = useMemo(() => (answers ? rankQuestions(answers, data) : null), [answers, data]);
  const pos = useMemo(() => (wallet && j ? positionNow(wallet, j.prices) : null), [wallet, j]);
  const water = useMemo(() => {
    const w = data?.["wallet:water"];
    return w ? [...w.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-90).map(([, v]) => 100 * v) : [];
  }, [data]);
  const sport = useSport();
  // The sub-tab last shown; remembered.
  const [tabRaw, setTab] = usePref<Tab>("insights:tab", "overview");
  const tab = oneOf(tabRaw, ["overview", "correlations", "questions"], "overview");
  const synthetic = body?.source === "whoop-synthetic" || wallet?.source === "synthetic";
  const waiting = (
    <View style={s.wait}>
      <ActivityIndicator color={color.body} />
      <Text style={type.small}>{progress ? `Asking the questions · ${progress[0]} of ${progress[1]}` : "Waiting for the market"}</Text>
    </View>
  );

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.top}>
          <Text style={type.title}>Insights</Text>
          {synthetic ? <Text style={s.synthetic}>Synthetic</Text> : null}
        </View>

        <ResToggle
          options={[
            { key: "overview", label: "Overview" },
            { key: "correlations", label: "Correlations" },
            { key: "questions", label: "Questions" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "correlations" ? (
          sport ? (
            <CorrCard corr={sport.corr} />
          ) : (
            waiting
          )
        ) : tab === "questions" ? (
          questions ? (
            <>
              <Pressable onPress={() => router.push("/terms" as never)} hitSlop={8} style={s.caption}>
                <Text style={type.small}>Most important first · tap one for its details</Text>
                <Text style={s.info}>ⓘ</Text>
              </Pressable>
              <QuestionList items={questions} />
            </>
          ) : (
            waiting
          )
        ) : (
          <>
            {sport ? <BestCard splits={sport.splits} extremes={sport.extremes} /> : waiting}
            {pos ? (
              <View style={s.card}>
                <View style={s.posRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.label}>Coins vs cost</Text>
                    <Text style={[s.big, { color: pos.gain < 0 ? TONE_COLOR.bad : TONE_COLOR.good }]}>
                      {pos.gain < 0 ? "▼" : "▲"} {Math.abs(100 * pos.pct).toFixed(1)}%
                    </Text>
                    <Text style={type.small}>
                      {signed(pos.gain)} · {pos.under ? `${pos.under} of ${pos.coins} underwater` : "none underwater"}
                    </Text>
                  </View>
                  {water.length > 2 ? <Sparkline values={water} tint={water[water.length - 1] < 0 ? TONE_COLOR.bad : TONE_COLOR.good} width={120} height={44} /> : null}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { gap: space.l, padding: space.l, paddingBottom: space.xxl },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  synthetic: { ...type.label, color: color.synthetic },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  wait: { alignItems: "center", gap: space.s, paddingVertical: space.l },
  caption: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: -space.s },
  info: { fontSize: 14, color: color.faint },
  posRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  big: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
