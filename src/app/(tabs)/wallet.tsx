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
import { ALL, connectProblem, shortAddress } from "../../wallets";
import { BalanceRing, YourCoins } from "../../yourcoins";
import { TESTING } from "../../flags";

const RING = 264;
const RING_STROKE = 12;
const open = (path: string) => router.push(path as never);

/**
 * Wallet: what it holds, in dollars, as a wallet shows it, and is this week's
 * trading heavier, usual or lighter than the four before it (`walletread.ts`);
 * then the coins, and every number behind the trading, each one tap from its chart.
 */
export default function Wallet() {
  const { address, wallets, groups, group, reading, addWallet, selectWallet, combine, removeGroup, removeWallet, view: v, busy, error, refresh, synthetic, loadSynthetic, removeSynthetic, coins } =
    useWalletData();
  const [connectError, setConnectError] = useState<string | null>(null);
  // A request is open in the wallet app; a second tap would queue another behind it.
  const [adding, setAdding] = useState(false);
  // The list of wallets, opened from the account row; and, while combining, the wallets ticked.
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const close = () => {
    setPicking(false);
    setChoosing(false);
  };
  const pick = (key: string) => {
    selectWallet(key);
    close();
  };
  const toggle = (a: string) => setChosen((c) => (c.includes(a) ? c.filter((x) => x !== a) : [...c, a]));
  // Starts from what is read now: the group's wallets, or the one wallet.
  const startChoosing = () => {
    setChosen(group ? group.members : address ? [address] : []);
    setChoosing(true);
  };
  const g = useMemo(() => (v ? walletGlance(v) : null), [v]);
  const tw = useMemo(() => (v ? tradingWeek(v) : null), [v]);
  const bal = balanceOf(coins);

  const add = async () => {
    if (adding) return;
    setConnectError(null);
    setAdding(true);
    try {
      const r = await addWallet();
      if (r.added) close();
      else {
        setConnectError(
          `The wallet app gave ${shortAddress(r.address)}, which is already added. To add another, switch to a different account in the wallet app first, or choose another wallet app.`,
        );
      }
    } catch (e) {
      setConnectError(connectProblem(e));
    } finally {
      setAdding(false);
    }
  };
  const waiting = "Waiting for the wallet app…";
  const confirmRemove = (a: string) =>
    Alert.alert("Remove wallet?", `${shortAddress(a)} and its history are deleted from this phone. Add it again any time.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeWallet(a).catch((e) => Alert.alert("Could not remove", e instanceof Error ? e.message : String(e))),
      },
    ]);
  const confirmRemoveGroup = (key: string, name: string) =>
    Alert.alert("Remove this group?", `${name} stops being read together. Its wallets stay.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void removeGroup(key) },
    ]);
  const active = wallets.find((w) => w.address === address) ?? null;

  if (!address && !synthetic) {
    return (
      <SafeAreaView style={s.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={s.intro}>
          <Text style={type.label}>Wallet</Text>
          <Text style={type.title}>Are you trading more than usual?</Text>
          <Text style={[type.body, { color: color.muted }]}>Heart Alpha only reads your wallet's history, on this phone. It never asks you to sign.</Text>
          <Pressable style={({ pressed }) => [s.button, (pressed || adding) && { opacity: 0.8 }]} onPress={add} disabled={adding}>
            <Text style={s.buttonText}>{adding ? waiting : "Connect wallet"}</Text>
          </Pressable>
          {connectError ? <Text style={[type.small, { color: color.below }]}>{connectError}</Text> : null}
          {TESTING ? (
            <Pressable style={({ pressed }) => [s.secondary, pressed && { opacity: 0.8 }]} onPress={loadSynthetic}>
              <Text style={s.secondaryText}>No history yet? Try synthetic trades</Text>
            </Pressable>
          ) : null}
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
          {address ? (
            <View style={s.accounts}>
              <Pressable onPress={() => (picking ? close() : setPicking(true))} style={({ pressed }) => [s.account, pressed && { opacity: 0.7 }]} hitSlop={4}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={s.accountName}>{group ? group.name : shortAddress(address)}</Text>
                  {group ? <Text style={type.small}>Combined · {group.members.length} wallets</Text> : active?.label ? <Text style={type.small}>{active.label}</Text> : null}
                </View>
                <Text style={s.accountMore}>
                  {wallets.length > 1 ? `${wallets.length} wallets ` : ""}
                  {picking ? "▴" : "▾"}
                </Text>
              </Pressable>
              {picking ? (
                <View style={s.list}>
                  {choosing ? <Text style={[type.small, s.listNote]}>Pick the wallets to read together.</Text> : null}
                  {wallets.map((w) => {
                    const on = choosing ? chosen.includes(w.address) : w.address === address;
                    return (
                      <View key={w.address} style={s.walletRow}>
                        <Pressable
                          onPress={() => (choosing ? toggle(w.address) : pick(w.address))}
                          style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.s }, pressed && { opacity: 0.6 }]}
                          hitSlop={4}
                        >
                          <Text style={[s.check, choosing ? null : !on && { opacity: 0 }]}>{choosing ? (on ? "☑" : "☐") : "✓"}</Text>
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text style={[s.walletName, !on && { color: color.muted }]}>{shortAddress(w.address)}</Text>
                            {w.label ? <Text style={type.small}>{w.label}</Text> : null}
                          </View>
                        </Pressable>
                        {!choosing ? (
                          <Pressable style={({ pressed }) => [s.accountButton, pressed && { opacity: 0.6 }]} onPress={() => confirmRemove(w.address)} hitSlop={6}>
                            <Text style={s.accountButtonText}>Remove</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  {choosing ? (
                    <View style={[s.walletRow, { gap: space.s }]}>
                      <Pressable
                        onPress={() => {
                          combine(chosen);
                          close();
                        }}
                        disabled={chosen.length < 2}
                        style={({ pressed }) => [s.combine, (pressed || chosen.length < 2) && { opacity: 0.5 }]}
                      >
                        <Text style={s.combineText}>{chosen.length < 2 ? "Pick two or more" : `Read ${chosen.length} together`}</Text>
                      </Pressable>
                      <Pressable style={({ pressed }) => [s.accountButton, pressed && { opacity: 0.6 }]} onPress={() => setChoosing(false)} hitSlop={6}>
                        <Text style={s.accountButtonText}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      {groups.length ? <Text style={[type.label, s.listHead]}>Combined</Text> : null}
                      {groups.map((gr) => {
                        const on = gr.key === address;
                        return (
                          <View key={gr.key} style={s.walletRow}>
                            <Pressable
                              onPress={() => pick(gr.key)}
                              style={({ pressed }) => [{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.s }, pressed && { opacity: 0.6 }]}
                              hitSlop={4}
                            >
                              <Text style={[s.check, !on && { opacity: 0 }]}>✓</Text>
                              <View style={{ flex: 1, gap: 1 }}>
                                <Text style={[s.walletName, !on && { color: color.muted }]}>{gr.name}</Text>
                                <Text style={type.small}>{gr.members.length} wallets</Text>
                              </View>
                            </Pressable>
                            {gr.key !== ALL ? (
                              <Pressable style={({ pressed }) => [s.accountButton, pressed && { opacity: 0.6 }]} onPress={() => confirmRemoveGroup(gr.key, gr.name)} hitSlop={6}>
                                <Text style={s.accountButtonText}>Remove</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                      {wallets.length >= 3 ? (
                        <Pressable onPress={startChoosing} style={({ pressed }) => [s.walletRow, pressed && { opacity: 0.6 }]} hitSlop={4}>
                          <Text style={s.check}>+</Text>
                          <Text style={s.walletName}>Combine wallets</Text>
                        </Pressable>
                      ) : null}
                      <Pressable onPress={add} disabled={adding} style={({ pressed }) => [s.walletRow, (pressed || adding) && { opacity: 0.6 }]} hitSlop={4}>
                        <Text style={s.check}>+</Text>
                        <Text style={s.walletName}>{adding ? waiting : "Add wallet"}</Text>
                      </Pressable>
                    </>
                  )}
                  {connectError ? <Text style={[type.small, { color: color.below, paddingBottom: space.s }]}>{connectError}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[s.accounts, s.account]}>
              <Text style={[s.accountName, { flex: 1, color: color.synthetic }]}>Synthetic trades</Text>
              <Pressable style={({ pressed }) => [s.accountButton, (pressed || adding) && { opacity: 0.6 }]} onPress={add} disabled={adding} hitSlop={8}>
                <Text style={s.accountButtonText}>{adding ? "Waiting…" : "Connect"}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [s.accountButton, pressed && { opacity: 0.6 }]} onPress={removeSynthetic} hitSlop={8}>
                <Text style={s.accountButtonText}>Remove</Text>
              </Pressable>
            </View>
          )}
          {connectError && !picking ? <Text style={[type.small, { color: color.below }]}>{connectError}</Text> : null}
        </View>

        {!v && busy ? (
          <View style={s.loading}>
            <ActivityIndicator color={color.wallet} />
            <Text style={type.small}>
              {synthetic
                ? "Generating trades…"
                : reading
                  ? `Reading wallet ${reading.done} of ${reading.of}: 120 days of signed transactions…`
                  : "Reading 120 days of signed transactions from the chain…"}
            </Text>
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
  accounts: { backgroundColor: color.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, overflow: "hidden" },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingLeft: space.l,
    paddingRight: space.m,
    paddingVertical: space.m,
  },
  accountMore: { fontSize: 14, fontWeight: "600", color: color.muted },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingHorizontal: space.l },
  walletRow: { flexDirection: "row", alignItems: "center", gap: space.s, paddingVertical: space.s + 2 },
  walletName: { fontSize: 15, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"] },
  listHead: { paddingTop: space.m, paddingBottom: space.xs },
  listNote: { paddingTop: space.s },
  combine: { flex: 1, backgroundColor: color.wallet, borderRadius: 8, paddingVertical: space.s + 2, alignItems: "center" },
  combineText: { color: color.bg, fontSize: 14, fontWeight: "700" },
  check: { width: 16, fontSize: 15, fontWeight: "700", color: color.text, textAlign: "center" },
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
