import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { correlations, signedR, strength } from "../../correlation";
import { useMarket } from "../../data";
import { fngColor, fngWord, premiumSeries, tail } from "../../labels";
import { BAND_COLOR, scores } from "../../scores";
import { color, space, type } from "../../theme";
import { fmt, ListRow, Ring, Section } from "../../ui";

const open = (id: string) => router.push(`/chart/${id}` as never);

/** DVOL against its own normal, coloured for what it means to a trader: calm is good news. */
const dvolPill = {
  below: { text: "Calm", tint: "#2F7D57" },
  within: { text: "Normal", tint: "#3A3F48" },
  above: { text: "Elevated", tint: "#B8652F" },
} as const;

/**
 * Market: how stressed it is and what that means for the size of a position
 * on its own, then its volatility, how its pieces move together, and its
 * sentiment. Prices and coins are the Wallet's.
 */
export default function Market() {
  const { view: v, busy, error, refresh } = useMarket();
  const corr = useMemo(() => (v ? correlations(v) : null), [v]);
  const stress = useMemo(() => (v ? scores(null, null, v, null).stress : null), [v]);
  const sizing = stress ? Math.round((100 * Math.min(1, stress.typical / stress.dvol)) / 5) * 5 : null;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} colors={[color.market]} progressBackgroundColor={color.raised} />}
      >
        <Text style={[type.title, s.pad]}>Market</Text>
        {!v ? <Text style={[type.small, s.pad]}>{busy ? "Loading the market…" : error ? `Could not reach the market: ${error}` : " "}</Text> : null}

        {stress ? (
          <Pressable onPress={() => open("dvol")} android_ripple={{ color: color.raised }} style={s.stress}>
            <View style={{ width: 96 }}>
              <Ring pct={stress.pct} tint={BAND_COLOR[stress.band]} label="Stress" size={84} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.stressHead}>
                {stress.pct <= 33 ? "Calmer than usual" : stress.pct >= 67 ? "More stressed than usual" : "About usual"}
              </Text>
              {sizing !== null ? <Text style={[type.small, { color: color.muted }]}>{sizing >= 100 ? "Usual size" : `${sizing}% of usual size`} · from options</Text> : null}
            </View>
          </Pressable>
        ) : null}

        {v ? (
          <>
            <Section title="Volatility">
              {v.dvol ? (
                <ListRow
                  title="DVOL"
                  subtitle="BTC, 30 days"
                  spark={tail(v.dvolSeries.map((d) => d.value))}
                  tint={color.market}
                  value={fmt.vol(v.dvol.value)}
                  pill={dvolPill[v.dvol.position]}
                  onPress={() => open("dvol")}
                />
              ) : null}
              {v.premium !== null ? (
                <ListRow
                  title="Fear premium"
                  subtitle="Implied − realised"
                  spark={tail(premiumSeries(v).map((p) => p[1]))}
                  tint={color.market}
                  value={`${v.premium > 0 ? "+" : ""}${v.premium.toFixed(0)}`}
                  onPress={() => open("premium")}
                />
              ) : null}
              <ListRow
                title="SOL volatility index"
                subtitle="Implied, ours"
                spark={v.solIndexHistory.length > 1 ? v.solIndexHistory.map((p) => p[1]) : undefined}
                tint={color.market}
                value={v.solIndex ? fmt.vol(v.solIndex.value) : "–"}
                onPress={() => open("solindex")}
              />
              <ListRow
                title="SOL realised"
                subtitle="30 days"
                spark={tail(v.solRealisedSeries.map((p) => p[1]))}
                tint={color.muted}
                value={fmt.vol(v.solRealised)}
                onPress={() => open("solindex")}
              />
            </Section>

            {corr && (corr.solBtc.length || corr.solFear.length) ? (
              <Section title="Correlations">
                {corr.solBtc.length ? (
                  <ListRow
                    title="SOL ↔ BTC"
                    subtitle="Daily moves, 30 days"
                    spark={tail(corr.solBtc.map((p) => p[1]))}
                    tint={color.market}
                    value={signedR(corr.solBtc[corr.solBtc.length - 1][1])}
                    pill={{ text: strength(corr.solBtc[corr.solBtc.length - 1][1]), tint: "#3A3F48" }}
                    onPress={() => open("corr")}
                  />
                ) : null}
                {corr.solFear.length ? (
                  <ListRow
                    title="SOL ↔ fear"
                    subtitle="SOL vs DVOL's daily change, 30 days"
                    spark={tail(corr.solFear.map((p) => p[1]))}
                    tint={color.market}
                    value={signedR(corr.solFear[corr.solFear.length - 1][1])}
                    pill={{ text: strength(corr.solFear[corr.solFear.length - 1][1]), tint: "#3A3F48" }}
                    onPress={() => open("corr")}
                  />
                ) : null}
              </Section>
            ) : null}
            <Section title="Sentiment">
              {v.fng ? (
                <ListRow
                  title="Fear & Greed"
                  subtitle="Bitcoin"
                  spark={tail(v.fngSeries.map((p) => p[1]))}
                  tint={color.muted}
                  value={`${v.fng.value}`}
                  pill={{ text: fngWord(v.fng.value), tint: fngColor(v.fng.value) }}
                  onPress={() => open("fng")}
                />
              ) : null}
            </Section>

          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { gap: space.xl, paddingTop: space.m, paddingBottom: space.xxl },
  pad: { paddingHorizontal: space.l },
  stress: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    marginHorizontal: space.l,
    padding: space.m,
    borderRadius: 14,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  stressHead: { fontSize: 16, fontWeight: "600", color: color.text },
  foot: { color: color.faint, textAlign: "center", paddingHorizontal: space.l },
});
