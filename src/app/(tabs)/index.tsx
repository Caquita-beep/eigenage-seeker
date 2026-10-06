import { router } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { bodyDetail } from "../../bodyread";
import { useBody, useExposure, useMarket, useWalletData } from "../../data";
import { action, bodyPillar, marketPillar, TONE_COLOR, tradingPillar, type Tone } from "../../insight";
import { JournalList } from "../../journallist";
import { balanceOf, changeLine, money } from "../../holdings";
import { DOWN, UP } from "../../indicators";
import { BalanceRing } from "../../yourcoins";
import { sides } from "../../linkread";
import { daySummary, pct0, signed, useJournal } from "../../journalread";
import { addDays, nightOf } from "../../engine/nights";
import { fngWord } from "../../labels";
import { color, space, type } from "../../theme";
import { tradingWeek } from "../../walletread";

const open = (path: string) => router.push(path as never);

/**
 * Today: the dashboard. What to do, then one card per tab — Body, Market,
 * Wallet — with the figures that matter from each and its state, then the
 * reader's own pattern. Each card opens its tab, where the detail is.
 */
export default function Today() {
  const { body, busy, stage, fraction, error, importApple, connectHealthConnect, loadSynthetic } = useBody();
  const { view: market } = useMarket();
  const { view: wallet, coins } = useWalletData();
  const bal = balanceOf(coins);
  const { answers } = useExposure();

  const bp = useMemo(() => (body ? bodyPillar(body) : null), [body]);
  const bd = useMemo(() => (body ? bodyDetail(body) : null), [body]);
  const mp = useMemo(() => (market ? marketPillar(market) : null), [market]);
  const tp = useMemo(() => (wallet ? tradingPillar(wallet) : null), [wallet]);
  const tw = useMemo(() => (wallet ? tradingWeek(wallet) : null), [wallet]);
  const act = useMemo(() => action(bp, mp, tp), [bp, mp, tp]);
  const { journal: j } = useJournal();
  // Yesterday's trading against the reader's usual and the body they woke with; and today so far.
  const days = useMemo(() => {
    if (!j || !wallet?.load.length) return null;
    const today = nightOf(Date.now() / 1000, -new Date().getTimezoneOffset());
    const has = (n: string) => wallet.load.some((p) => p.night === n);
    const yesterday = has(addDays(today, -1)) ? addDays(today, -1) : wallet.load[wallet.load.length - 1].night;
    return { y: daySummary(j, wallet, yesterday, market), isYesterday: yesterday === addDays(today, -1), today: has(today) ? daySummary(j, wallet, today, market) : null };
  }, [j, wallet, market]);
  // The tested link, applied to this morning: when the HRV on the Body card is below its normal and the
  // reader's history shows they swap more after below-normal mornings. Below the card's ±1 SD range is
  // also below the narrower range the link was tested on, so the history speaks to this morning.
  const { data } = useExposure();
  const habit = useMemo(() => {
    const a = answers?.find((x) => x.h.id === "readiness-trading");
    if (!a || !data || a.r.status !== "result" || !a.r.detected || a.r.suspect || a.r.effect <= 0) return null;
    if (bd?.hrv?.arrow !== "down") return null;
    const sd = sides(a.h, data);
    if (!sd) return null;
    const ease = act?.tone === "bad" || act?.tone === "watch";
    return `Mornings like this, you swap ${sd.yes.value} of your wallet. Usually ${sd.no.value}.${ease ? " Hold back." : ""}`;
  }, [answers, data, act, bd]);

  if (!body) {
    return (
      <SafeAreaView style={s.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={s.intro}>
          <Text style={type.label}>Today</Text>
          <Text style={type.title}>Each morning: should you trade, and how much?</Text>
          <Text style={[type.body, { color: color.muted }]}>Connect your health data. Everything stays on this phone.</Text>
          <Connect title="Health Connect" steps="Oura, Whoop, Garmin, Fitbit, Samsung and others." button="Connect Health Connect" onPress={connectHealthConnect} disabled={busy} />
          <Connect title="Apple Watch" steps="Export from the Health app on your iPhone, send export.zip here." button="Import Apple Health export" onPress={importApple} disabled={busy} />
          <Connect title="No wearable yet?" steps="Try it with generated data." button="Load synthetic data" onPress={loadSynthetic} disabled={busy} />
          {busy ? <Working stage={stage} fraction={fraction} /> : null}
          {error ? <Text style={[type.small, { color: color.below }]}>{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const synthetic = body.source === "whoop-synthetic" || wallet?.source === "synthetic";
  const perDay = (annual: number) => annual / Math.sqrt(365);
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

  const hrvTone: Tone = bd?.hrv?.arrow === "down" ? "bad" : "neutral";
  const lateNights = wallet ? wallet.load.slice(-7).reduce((n, p) => n + p.awake, 0) : 0;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.top}>
          <Text style={type.title}>Today</Text>
          <Text style={type.label}>
            {synthetic ? <Text style={{ color: color.synthetic }}>Synthetic · </Text> : null}
            {dateLabel}
          </Text>
        </View>

        {act ? (
          <Pressable onPress={() => open("/body")} style={[s.action, { borderColor: TONE_COLOR[act.tone] }]}>
            <View style={s.actionHead}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR[act.tone] }]} />
              <Text style={[s.actionText, { color: TONE_COLOR[act.tone] }]}>{act.headline}</Text>
            </View>
            <Text style={s.size}>{act.sizeLine}</Text>
            {habit ? <Text style={[s.habit, { color: TONE_COLOR.watch }]}>{habit}</Text> : null}
          </Pressable>
        ) : null}

        {coins.rows.length ? (
          <Pressable onPress={() => open("/wallet")} android_ripple={{ color: color.raised }} style={({ pressed }) => [s.card, s.balanceCard, pressed && { opacity: 0.8 }]}>
            <BalanceRing coins={coins} size={76} stroke={9}>
              {null}
            </BalanceRing>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.cardHead}>
                <Text style={type.label}>Balance</Text>
                <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>Wallet ›</Text>
              </View>
              <Text style={s.balance} adjustsFontSizeToFit numberOfLines={1}>
                {bal ? money(bal.total) : "–"}
              </Text>
              {bal && bal.pct !== null ? <Text style={[s.balanceChange, { color: bal.change >= 0 ? UP : DOWN }]}>{changeLine(bal)}</Text> : null}
            </View>
          </Pressable>
        ) : null}

        {days?.y ? (
          <Pressable onPress={() => open("/recap")} android_ripple={{ color: color.raised }} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
            <View style={s.cardHead}>
              <Text style={type.label}>{days.isYesterday ? "Yesterday" : dayShort(days.y.night)}</Text>
              <Text style={[s.cardState, { color: days.y.tone === "neutral" ? color.muted : TONE_COLOR[days.y.tone] }]}>{days.y.word} ›</Text>
            </View>
            <View style={s.figs}>
              <Fig label="Trades" value={`${days.y.trades}`} tone="neutral" />
              <Fig label="Wallet moved" value={pct0(days.y.moved)} note={days.y.usual !== null ? `usual ${pct0(days.y.usual)}` : undefined} tone="neutral" />
              <Fig label="Realised" value={Math.abs(days.y.realised) >= 1 ? signed(days.y.realised) : "–"} tone={days.y.realised > 0.5 ? "good" : days.y.realised < -0.5 ? "bad" : "neutral"} />
            </View>
          </Pressable>
        ) : null}

        <View style={[s.card, { paddingVertical: space.xs }]}>
          <Row title="Body" state={bp?.state ?? "Learning"} tone={bp?.tone ?? "neutral"} onPress={() => open("/body")}>
            <Num v={bd?.hrv ? `${bd.hrv.value.toFixed(0)} ms` : "–"} k="HRV" tone={hrvTone} />
            <Num v={bd?.cv ? `${bd.cv.value.toFixed(1)}%` : "–"} k="CV" tone={bd?.cv?.arrow === "up" ? "watch" : "neutral"} />
            <Num v={bd?.rhr ? `${bd.rhr.value.toFixed(0)}` : "–"} k="RHR" tone={bd?.rhr?.arrow === "up" ? "bad" : "neutral"} />
          </Row>
          <Row title="Market" state={mp?.state ?? "Loading"} tone={mp?.tone ?? "neutral"} onPress={() => open("/market")} divider>
            <Num v={market?.sol ? `$${market.sol.price.toFixed(0)}` : "–"} k={market?.sol?.change1d != null ? sign(market.sol.change1d) : "SOL"} tone={(market?.sol?.change1d ?? 0) < 0 ? "bad" : "good"} />
            <Num v={market?.dvol ? `${perDay(market.dvol.value).toFixed(1)}%` : "–"} k="move/day" tone={market?.dvol?.position === "above" ? "watch" : "neutral"} />
            <Num v={market?.fng ? `${market.fng.value}` : "–"} k={market?.fng ? fngWord(market.fng.value).toLowerCase() : "F&G"} tone={market?.fng && (market.fng.value < 25 || market.fng.value > 75) ? "watch" : "neutral"} />
          </Row>
          <Row title="Wallet" state={tp?.state ?? "Connect"} tone={tp?.tone ?? "neutral"} onPress={() => open("/wallet")} divider>
            {wallet && tw ? (
              <>
                <Num v={`${Math.round(tw.moved * 100)}%`} k="this week" tone="neutral" />
                <Num v={tw.ratio !== null ? `${tw.ratio.toFixed(1)}×` : "–"} k="usual" tone={tw.weight === "heavier" ? "watch" : "neutral"} />
                <Num v={`${lateNights}`} k="late nights" tone={lateNights >= 2 ? "watch" : "neutral"} />
              </>
            ) : null}
          </Row>
        </View>

        {j ? (
          <View style={[s.card, { paddingBottom: space.xs }]}>
            <Pressable onPress={() => open("/journal")} style={s.cardHead} hitSlop={8}>
              <Text style={type.label}>Journal</Text>
              <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>All ›</Text>
            </Pressable>
            <JournalList j={j} kind="week" limit={3} compact />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const dayShort = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** One tab in a line: its name and state, then its three numbers. The whole line opens the tab. */
function Row({ title, state, tone, onPress, divider, children }: { title: string; state: string; tone: Tone; onPress: () => void; divider?: boolean; children?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, divider && s.divider, pressed && { opacity: 0.6 }]}>
      <View style={s.rowHead}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={[s.rowState, { color: tone === "neutral" ? color.muted : TONE_COLOR[tone] }]}>{state} ›</Text>
      </View>
      <View style={s.nums}>{children}</View>
    </Pressable>
  );
}

function Num({ v, k, tone }: { v: string; k: string; tone: Tone }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.numV, tone !== "neutral" && { color: TONE_COLOR[tone] }]}>{v}</Text>
      <Text style={s.numK}>{k}</Text>
    </View>
  );
}

function Fig({ label, value, note, tone }: { label: string; value: string; note?: string; tone: Tone }) {
  return (
    <View style={s.fig}>
      <Text style={type.small}>{label}</Text>
      <Text style={s.figValue}>{value}</Text>
      {note ? <Text style={[s.figNote, { color: tone === "neutral" ? color.muted : TONE_COLOR[tone] }]}>{note}</Text> : null}
    </View>
  );
}

function Connect({ title, steps, button, onPress, disabled }: { title: string; steps: string; button: string; onPress: () => void; disabled: boolean }) {
  return (
    <View style={s.connect}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={[type.small, { color: color.muted }]}>{steps}</Text>
      <Pressable style={({ pressed }) => [s.button, (pressed || disabled) && { opacity: 0.6 }]} onPress={onPress} disabled={disabled}>
        <Text style={s.buttonText}>{button}</Text>
      </Pressable>
    </View>
  );
}

function Working({ stage, fraction }: { stage: string | null; fraction: number | null }) {
  return (
    <View style={{ gap: space.s }}>
      <Text style={type.small}>{stage ?? "Working…"}</Text>
      <View style={s.barTrack}>
        {fraction !== null ? <View style={[s.barFill, { width: `${Math.round(fraction * 100)}%` }]} /> : <ActivityIndicator color={color.body} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  intro: { padding: space.xl, gap: space.l },
  content: { gap: space.l, padding: space.l, paddingBottom: space.xxl },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  action: { backgroundColor: color.surface, borderRadius: 16, borderWidth: 1.5, padding: space.l, gap: 4 },
  actionHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 14, height: 14, borderRadius: 7 },
  actionText: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: "700" },
  size: { fontSize: 16, fontWeight: "600", color: color.text, paddingLeft: 26 },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardState: { fontSize: 17, fontWeight: "700" },
  recapWord: { flex: 1, fontSize: 19, fontWeight: "700" },
  balanceCard: { flexDirection: "row", alignItems: "center", gap: space.l },
  balance: { fontSize: 28, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  balanceChange: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  row: { paddingVertical: space.m, gap: 6 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  rowTitle: { fontSize: 15, fontWeight: "700", color: color.text },
  rowState: { fontSize: 15, fontWeight: "700" },
  nums: { flexDirection: "row", gap: space.s },
  numV: { fontSize: 17, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  numK: { fontSize: 12, color: color.faint },
  habit: { fontSize: 14, lineHeight: 19, fontWeight: "600", paddingLeft: 26, paddingTop: 4 },
  figs: { flexDirection: "row", gap: space.s },
  fig: { flex: 1, gap: 2 },
  figValue: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figNote: { fontSize: 12.5, fontWeight: "600" },
  foot: { color: color.faint, textAlign: "center" },
  connect: { backgroundColor: color.surface, borderRadius: 14, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  cardTitle: { fontSize: 15.5, fontWeight: "600", color: color.text },
  button: { backgroundColor: color.body, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: "hidden", justifyContent: "center" },
  barFill: { height: 6, backgroundColor: color.body },
});
