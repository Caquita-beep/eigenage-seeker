import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBody, useExposure } from "../../data";
import { TONE_COLOR, type Tone } from "../../insight";
import { positionNow, signed, useJournal } from "../../journalread";
import { knownCoin } from "../../coins";
import { coinLinks, LINKS, readLink, sides, type CoinLink } from "../../linkread";
import { color, space, type } from "../../theme";
import { Sparkline } from "../../ui";
import { CoinLogo } from "../../yourcoins";
import { BestCard, CorrCard } from "../../sportcards";
import { useSport } from "../../sportread";

const open = (path: string) => router.push(path as never);
const toneColor = (t: Tone) => (t === "neutral" ? color.muted : TONE_COLOR[t]);

/**
 * Insights: the reader's trading read as a sport (`sport.ts`), then the links
 * between the market, their trading and their body from their own history.
 * The week's load and intensity are on Today.
 *
 *   Trade best       results split by the body, SOL's moves, the market's
 *                    mood, the clock and the week coming in
 *   Correlations     each factor of the day against the next morning's HRV
 *                    and against how much of the wallet was moved
 *   Tested links     the registry's questions, each with its two sides'
 *                    numbers; the sentence, chart and statistics on its page
 */
export default function Insights() {
  const { answers, progress, data } = useExposure();
  const { body } = useBody();
  const { journal: j, wallet } = useJournal();

  const links = useMemo(
    () =>
      answers
        ? LINKS.map((l) => answers.find((x) => x.h.id === l.id))
            .filter((a) => a !== undefined)
            .map((a) => ({ read: readLink(a!, undefined, data), sd: data ? sides(a!.h, data) : null }))
        : null,
    [answers, data],
  );
  const coins = useMemo(() => (answers ? coinLinks(answers, data) : []), [answers, data]);
  const pos = useMemo(() => (wallet && j ? positionNow(wallet, j.prices) : null), [wallet, j]);
  const water = useMemo(() => {
    const w = data?.["wallet:water"];
    return w ? [...w.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-90).map(([, v]) => 100 * v) : [];
  }, [data]);
  const sport = useSport();
  const synthetic = body?.source === "whoop-synthetic" || wallet?.source === "synthetic";

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.top}>
          <Text style={type.title}>Insights</Text>
          {synthetic ? <Text style={s.synthetic}>Synthetic</Text> : null}
        </View>

        {sport ? (
          <>
            <BestCard splits={sport.splits} extremes={sport.extremes} />
            <CorrCard rows={sport.corr} />
          </>
        ) : null}

        <View style={[s.card, { paddingTop: space.l, paddingBottom: space.xs, gap: 0 }]}>
          <Text style={type.label}>Tested links</Text>
          {!links ? (
            <View style={s.wait}>
              <ActivityIndicator color={color.body} />
              <Text style={type.small}>{progress ? `${progress[0]} of ${progress[1]}` : "Waiting for the market"}</Text>
            </View>
          ) : (
            links.map(({ read, sd }, k) => {
              const on = read.status === "found" || read.status === "partial";
              return (
                <Pressable key={read.id} onPress={() => open(`/link/${read.id}`)} style={({ pressed }) => [s.link, s.divider, k === 0 && { marginTop: space.s }, pressed && { opacity: 0.6 }]}>
                  <View style={s.linkHead}>
                    <View style={[s.dot, { backgroundColor: on ? toneColor(read.tone) : "transparent", borderColor: on ? toneColor(read.tone) : color.faint }]} />
                    <Text style={[s.linkTitle, !on && { color: color.muted }]}>{read.title}</Text>
                    <Text style={[s.chip, { color: on ? toneColor(read.tone) : color.faint }]}>{read.word} ›</Text>
                  </View>
                  {on && sd ? (
                    <Text style={s.nums}>
                      <Text style={{ color: TONE_COLOR.watch, fontWeight: "700" }}>{sd.yes.value}</Text> vs {sd.no.value} · {sd.short}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>

        {coins.length ? (
          <View style={[s.card, { paddingBottom: space.xs }]}>
            <Text style={type.label}>Your coins → your body</Text>
            <Text style={s.coinsHead}>{coinsHeadline(coins)}</Text>
            <Text style={[type.small, { alignSelf: "flex-end" }]}>Next-morning HRV after up · down days</Text>
            {coins.map((c, k) => {
              const on = c.read.status === "found";
              return (
                <Pressable
                  key={c.id}
                  onPress={() => open(`/link/${encodeURIComponent(c.id)}`)}
                  style={({ pressed }) => [s.coinRow, k > 0 && s.divider, pressed && { opacity: 0.6 }]}
                >
                  <CoinLogo uri={knownCoin(c.mint)?.image ?? null} symbol={c.symbol} />
                  <Text style={s.coinSym}>{c.symbol}</Text>
                  <Text style={s.coinNums}>{c.sd ? `${c.sd.yes.value} · ${c.sd.no.value}` : ""}</Text>
                  <Text style={[s.chip, { color: on ? toneColor(c.read.tone) : color.faint, minWidth: 74, textAlign: "right" }]}>{c.read.word} ›</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

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

        <Pressable onPress={() => open("/exposure")} hitSlop={8}>
          <Text style={s.more}>All questions ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Which coin's rises go with the reader's better mornings, in a line: the found link with the best effect, else what is still missing. */
function coinsHeadline(coins: CoinLink[]): string {
  const best = coins.find((c) => c.read.status === "found" && (c.effect ?? 0) > 0);
  if (best) return `Your best mornings follow ${best.symbol}'s up days.`;
  const worst = coins.find((c) => c.read.status === "found");
  if (worst) return `${worst.symbol}'s up days go with lower HRV.`;
  if (coins.every((c) => c.read.status === "learning" || c.read.status === "missing")) return "Learning from your history.";
  return "No coin's moves show in your HRV yet.";
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { gap: space.l, padding: space.l, paddingBottom: space.xxl },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  synthetic: { ...type.label, color: color.synthetic },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  wait: { alignItems: "center", gap: space.s, paddingVertical: space.l },
  link: { gap: 4, paddingVertical: space.m },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  linkHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 1.5 },
  linkTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: color.text },
  chip: { fontSize: 14, fontWeight: "700" },
  nums: { fontSize: 14, color: color.muted, paddingLeft: 19, fontVariant: ["tabular-nums"] },
  posRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  big: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  more: { fontSize: 14, color: color.muted, fontWeight: "600" },
  coinsHead: { fontSize: 17, fontWeight: "700", color: color.text },
  coinRow: { flexDirection: "row", alignItems: "center", gap: space.m, paddingVertical: space.m },
  coinSym: { flex: 1, fontSize: 16, fontWeight: "700", color: color.text },
  coinNums: { fontSize: 14, color: color.muted, fontVariant: ["tabular-nums"] },
});
