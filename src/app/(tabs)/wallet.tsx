import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWalletData } from "../../data";
import { TONE } from "../../glance";
import { DOWN, UP } from "../../indicators";
import { tail } from "../../labels";
import { color, space, type } from "../../theme";
import { fmt, ListRow, Section } from "../../ui";
import { tradingWeek, walletGlance } from "../../walletread";
import { balanceOf, changeLine, money } from "../../holdings";
import { BalanceRing, YourCoins } from "../../yourcoins";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const RING = 264;
const RING_STROKE = 12;
const open = (path: string) => router.push(path as never);

/**
 * Wallet: what it holds, in dollars, as a wallet shows it, and is this week's
 * trading heavier, usual or lighter than the four before it (`walletread.ts`);
 * then the coins, and every number behind the trading, each one tap from its chart.
 */
export default function Wallet() {
  const { connect } = useMobileWallet();
  const { address, view: v, busy, error, refresh, synthetic, loadSynthetic, removeSynthetic, disconnect, coins } = useWalletData();
  const [connectError, setConnectError] = useState<string | null>(null);
  const g = useMemo(() => (v ? walletGlance(v) : null), [v]);
  const tw = useMemo(() => (v ? tradingWeek(v) : null), [v]);
  const bal = balanceOf(coins);

  const confirmDisconnect = () =>
    Alert.alert("Disconnect wallet?", "Its history is deleted from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => disconnect().catch((e) => Alert.alert("Could not disconnect", e instanceof Error ? e.message : String(e))),
      },
    ]);

  if (!address && !synthetic) {
    return (
      <SafeAreaView style={s.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={s.intro}>
          <Text style={type.label}>Wallet</Text>
          <Text style={type.title}>Are you trading more than usual?</Text>
          <Text style={[type.body, { color: color.muted }]}>EigenAge only reads your wallet's history, on this phone. It never asks you to sign.</Text>
          <Pressable
            style={({ pressed }) => [s.button, pressed && { opacity: 0.8 }]}
            onPress={async () => {
              setConnectError(null);
              try {
                await connect();
              } catch (e) {
                setConnectError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <Text style={s.buttonText}>Connect wallet</Text>
          </Pressable>
          {connectError ? <Text style={[type.small, { color: color.below }]}>{connectError}</Text> : null}
          <Pressable style={({ pressed }) => [s.secondary, pressed && { opacity: 0.8 }]} onPress={loadSynthetic}>
            <Text style={s.secondaryText}>No history yet? Try synthetic trades</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const load = v?.load ?? [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={busy && !!v} onRefresh={refresh} colors={[color.wallet]} progressBackgroundColor={color.raised} />}
      >
        <View style={[s.pad, { gap: space.m }]}>
          <Text style={type.title}>Wallet</Text>
          <View style={s.account}>
            <Text style={[s.accountName, synthetic && { color: color.synthetic }]}>{address ? short(address) : "Synthetic trades"}</Text>
            <Pressable
              style={({ pressed }) => [s.accountButton, pressed && { opacity: 0.6 }]}
              onPress={address ? confirmDisconnect : removeSynthetic}
              hitSlop={8}
            >
              <Text style={s.accountButtonText}>{address ? "Disconnect" : "Remove"}</Text>
            </Pressable>
          </View>
        </View>

        {!v && busy ? (
          <View style={s.loading}>
            <ActivityIndicator color={color.wallet} />
            <Text style={type.small}>{synthetic ? "Generating trades…" : "Reading 120 days of signed transactions from the chain…"}</Text>
          </View>
        ) : null}
        {error ? <Text style={[type.small, s.pad, { color: color.below }]}>Could not read the wallet: {error}</Text> : null}

        {v && g && tw ? (
          <>
            <View style={s.balance}>
              <BalanceRing coins={coins} size={RING} stroke={RING_STROKE}>
                <View style={s.inRing}>
                  <Text style={s.total} adjustsFontSizeToFit numberOfLines={1}>
                    {bal ? money(bal.total) : "–"}
                  </Text>
                  {bal && bal.pct !== null ? (
                    <Text style={[s.change, { color: bal.change >= 0 ? UP : DOWN }]} adjustsFontSizeToFit numberOfLines={1}>
                      {changeLine(bal)}
                    </Text>
                  ) : null}
                </View>
              </BalanceRing>
            </View>

            <Pressable onPress={() => open("/chart/load")} style={({ pressed }) => [s.load, pressed && { opacity: 0.7 }]}>
              <View style={[s.dot, { backgroundColor: TONE[g.tone] }]} />
              <Text style={[s.loadWord, { color: TONE[g.tone] }]}>{g.word}</Text>
              <Text style={s.loadLine}>
                {pct(tw.moved)} moved this week{tw.ratio !== null ? ` · ${tw.ratio.toFixed(1)}× usual` : ""} ›
              </Text>
            </Pressable>

            <YourCoins coins={coins} />

            <Section title="Load">
              <ListRow
                title="Trading load"
                subtitle="7 days"
                spark={tail(load.map((p) => p.value), 60)}
                tint={color.wallet}
                value={pct(tw.moved)}
                pill={tw.ratio !== null ? { text: `${tw.ratio.toFixed(1)}× usual`, tint: tw.weight === "heavier" ? "#B8652F" : "#3A3F48" } : undefined}
                onPress={() => open("/chart/load")}
              />
              <ListRow
                title="Swaps"
                subtitle="30 days"
                spark={tail(load.map((p) => p.swaps), 60)}
                tint={color.wallet}
                value={`${v.last30.swaps}`}
                onPress={() => open("/chart/load?sub=swaps")}
              />
              <ListRow
                title="Swapped"
                subtitle="30 days"
                spark={tail(load.map((p) => p.usd), 60)}
                tint={color.wallet}
                value={fmt.usd(v.last30.usd)}
                onPress={() => open("/chart/load?sub=usd")}
              />
            </Section>

            <Section title="Nights">
              <ListRow
                title="Awake after midnight"
                subtitle="00:00–05:00, 30 days"
                spark={tail(load.map((p) => p.awake), 60)}
                tint={color.wallet}
                value={`${v.last30.awakeNights}/30`}
                onPress={() => open("/chart/nights")}
              />
              <ListRow
                title="Signed after 22:00"
                subtitle="30 days"
                spark={tail(load.map((p) => p.late), 60)}
                tint={color.wallet}
                value={`${v.last30.lateActs}`}
                onPress={() => open("/chart/nights")}
              />
              <ListRow
                title="Failed"
                subtitle="30 days"
                tint={color.below}
                value={`${v.last30.failed}`}
                onPress={() => open("/chart/load?sub=count")}
              />
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  intro: { padding: space.xl, gap: space.l },
  content: { gap: space.xl, paddingTop: space.m, paddingBottom: space.xxl },
  pad: { paddingHorizontal: space.l },
  account: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingLeft: space.l,
    paddingRight: space.s,
    paddingVertical: space.s,
  },
  accountName: { fontSize: 15, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"] },
  accountButton: { paddingHorizontal: space.m, paddingVertical: space.s, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: color.muted },
  accountButtonText: { fontSize: 14, fontWeight: "600", color: color.text },
  loading: { alignItems: "center", gap: space.m, paddingVertical: space.xxl },
  balance: { alignItems: "center", gap: space.xs, paddingHorizontal: space.l, paddingTop: space.s },
  inRing: { width: RING - 2 * RING_STROKE - 36, alignItems: "center", gap: 4 },
  total: { fontSize: 40, fontWeight: "700", letterSpacing: -1, color: color.text, fontVariant: ["tabular-nums"], textAlign: "center" },
  change: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "center" },
  load: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: space.s,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: 999,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  loadWord: { fontSize: 15, fontWeight: "700" },
  loadLine: { fontSize: 14, color: color.muted, fontVariant: ["tabular-nums"] },
  advice: { fontSize: 18, fontWeight: "600", color: color.text },
  button: { backgroundColor: color.wallet, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: space.s },
  buttonText: { color: color.bg, fontSize: 16, fontWeight: "600" },
  secondary: { borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: color.line },
  secondaryText: { color: color.text, fontSize: 15, fontWeight: "600" },
  foot: { color: color.faint, textAlign: "center", paddingHorizontal: space.l },
});
