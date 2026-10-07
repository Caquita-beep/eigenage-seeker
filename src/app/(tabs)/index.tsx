import { router } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { bodyDetail } from "../../bodyread";
import { useBody, useExposure, useMarket, useWalletData } from "../../data";
import { AssessmentCard } from "../../assessmentcard";
import { action, bodyPillar, marketPillar, TONE_COLOR, tradingPillar, type Tone } from "../../insight";
import { JournalCalendar } from "../../journalcalendar";
import { balanceOf, changeLine, money } from "../../holdings";
import { DOWN, UP } from "../../indicators";
import { BalanceRing } from "../../yourcoins";
import { sides } from "../../linkread";
import { LoadCard, MixCard, strainList, ZONE } from "../../sportcards";
import { useSport } from "../../sportread";
import { usePref } from "../../prefs";
import { daySummary, pct0, signed, useJournal } from "../../journalread";
import { addDays, nightOf } from "../../engine/nights";
import { color, space, type } from "../../theme";

const open = (path: string) => router.push(path as never);

/**
 * Today: the dashboard. The assessment (what to do with the day, and the
 * body and market it was read from) first, always; then yesterday's trading,
 * the balance, the week's trading load and intensity and the journal's month,
 * in the order the reader chose. Each card opens where its detail is.
 */

type CardKey = "balance" | "load" | "intensity" | "yesterday" | "journal";
const CARDS: Record<CardKey, string> = { balance: "Balance", load: "Trading load", intensity: "Intensity", yesterday: "Yesterday", journal: "Journal" };
const DEFAULT_ORDER: CardKey[] = ["yesterday", "balance", "load", "intensity", "journal"];

/** The stored order, kept to cards that exist, with any card added since appended in its default place. */
function normalised(stored: unknown): CardKey[] {
  const known = Array.isArray(stored) ? stored.filter((k): k is CardKey => k in CARDS) : [];
  const kept = [...new Set(known)];
  return [...kept, ...DEFAULT_ORDER.filter((k) => !kept.includes(k))];
}
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

  // The sport layer (`sportread.ts`): the load and intensity cards, and yesterday's intensity in their words.
  const sport = useSport();
  const zone = useMemo(() => (sport && days?.y ? { s: sport.sessions.find((x) => x.night === days.y!.night) ?? null } : null), [sport, days]);

  // The cards below the assessment, in the reader's order (`prefs.ts`); long-press a card to reorder.
  // v2: yesterday moved next to the assessment by default (7 October 2026); orders saved before were only the old default.
  const [stored, setOrder] = usePref<CardKey[]>("today:order:v2", DEFAULT_ORDER);
  const order = normalised(stored);
  const [editing, setEditing] = useState(false);
  const edit = () => setEditing(true);
  const moveBy = (k: CardKey, by: -1 | 1) => {
    const i = order.indexOf(k);
    const to = i + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[i], next[to]] = [next[to], next[i]];
    setOrder(next);
  };

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

  const card = (k: CardKey): ReactNode => {
    switch (k) {
      case "balance":
        return coins.rows.length ? (
          <Pressable onPress={() => open("/wallet")} onLongPress={edit} android_ripple={{ color: color.raised }} style={({ pressed }) => [s.card, s.balanceCard, pressed && { opacity: 0.8 }]}>
            <BalanceRing coins={coins} size={76} stroke={9}>
              {null}
            </BalanceRing>
            <View style={{ gap: 4 }}>
              <View style={s.balanceHead}>
                <Text style={type.label}>Balance</Text>
                <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>Wallet ›</Text>
              </View>
              <Text style={s.balance} adjustsFontSizeToFit numberOfLines={1}>
                {bal ? money(bal.total) : "–"}
              </Text>
              {bal && bal.pct !== null ? <Text style={[s.balanceChange, { color: bal.change >= 0 ? UP : DOWN }]}>{changeLine(bal)}</Text> : null}
            </View>
          </Pressable>
        ) : null;
      case "load":
        return sport ? <LoadCard tw={sport.tw} weeks={sport.weeks} rhythm={sport.rhythm} heavy={sport.heavy} onLongPress={edit} /> : null;
      case "intensity":
        return sport ? <MixCard mixes={sport.mixes} zones={sport.zones} rest={sport.rest} onLongPress={edit} /> : null;
      case "yesterday":
        return days?.y ? (
          <Pressable onPress={() => open("/recap")} onLongPress={edit} android_ripple={{ color: color.raised }} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
            <View style={s.cardHead}>
              <Text style={type.label}>{days.isYesterday ? "Yesterday" : dayShort(days.y.night)}</Text>
              {zone ? (
                <Text style={[s.cardState, { color: zone.s ? ZONE[zone.s.zone].tint : color.muted }]}>{zone.s ? `${ZONE[zone.s.zone].word} day` : "Rest day"} ›</Text>
              ) : (
                <Text style={[s.cardState, { color: days.y.tone === "neutral" ? color.muted : TONE_COLOR[days.y.tone] }]}>{days.y.word} ›</Text>
              )}
            </View>
            <View style={s.figs}>
              <Fig label="Trades" value={`${days.y.trades}`} tone="neutral" />
              <Fig label="Wallet moved" value={pct0(days.y.moved)} note={days.y.usual !== null ? `usual ${pct0(days.y.usual)}` : undefined} tone="neutral" />
              <Fig label="Realised" value={Math.abs(days.y.realised) >= 1 ? signed(days.y.realised) : "–"} tone={days.y.realised > 0.5 ? "good" : days.y.realised < -0.5 ? "bad" : "neutral"} />
            </View>
            {zone?.s && zone.s.zone !== "easy" ? (
              <Text style={s.strains}>
                {strainList(zone.s.strains)}. <Text style={{ color: color.text, fontWeight: "700" }}>Keep today easy, or rest.</Text>
              </Text>
            ) : null}
          </Pressable>
        ) : null;
      case "journal":
        return j ? (
          <Pressable onLongPress={edit} style={s.card}>
            <Pressable onPress={() => open("/journal")} style={s.cardHead} hitSlop={8}>
              <Text style={type.label}>Journal</Text>
              <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>Totals ›</Text>
            </Pressable>
            <JournalCalendar j={j} />
          </Pressable>
        ) : null;
    }
  };
  const synthetic = body.source === "whoop-synthetic" || wallet?.source === "synthetic";

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

        {bd ? <AssessmentCard d={bd} act={act} market={mp} habit={habit} nights={body.hrv.length} /> : null}

        {editing ? (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={type.label}>Reorder cards</Text>
              <Pressable onPress={() => setEditing(false)} hitSlop={10}>
                <Text style={s.done}>Done</Text>
              </Pressable>
            </View>
            {order.map((k, i) => (
              <View key={k} style={[s.reorderRow, i > 0 && s.divider]}>
                <Text style={s.reorderName}>{CARDS[k]}</Text>
                <Pressable onPress={() => moveBy(k, -1)} disabled={i === 0} hitSlop={6} style={({ pressed }) => [s.arrow, (pressed || i === 0) && { opacity: 0.3 }]}>
                  <Text style={s.arrowText}>▲</Text>
                </Pressable>
                <Pressable onPress={() => moveBy(k, 1)} disabled={i === order.length - 1} hitSlop={6} style={({ pressed }) => [s.arrow, (pressed || i === order.length - 1) && { opacity: 0.3 }]}>
                  <Text style={s.arrowText}>▼</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          order.map((k) => <View key={k}>{card(k)}</View>)
        )}

        {!editing ? (
          <Pressable onPress={edit} hitSlop={8} style={{ alignSelf: "center" }}>
            <Text style={s.reorder}>Reorder cards</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const dayShort = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

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
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardState: { fontSize: 17, fontWeight: "700" },
  balanceCard: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.l },
  balanceHead: { flexDirection: "row", alignItems: "center", gap: space.l },
  reorder: { fontSize: 14, fontWeight: "600", color: color.muted, paddingVertical: space.s },
  done: { fontSize: 15, fontWeight: "700", color: color.text },
  reorderRow: { flexDirection: "row", alignItems: "center", gap: space.s, paddingVertical: space.s },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  reorderName: { flex: 1, fontSize: 16, fontWeight: "600", color: color.text },
  arrow: { width: 44, height: 36, borderRadius: 10, backgroundColor: color.raised, alignItems: "center", justifyContent: "center" },
  arrowText: { fontSize: 14, color: color.text },
  balance: { fontSize: 28, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  balanceChange: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  figs: { flexDirection: "row", gap: space.s },
  strains: { fontSize: 14, lineHeight: 20, color: color.muted },
  fig: { flex: 1, gap: 2 },
  figValue: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figNote: { fontSize: 12.5, fontWeight: "600" },
  connect: { backgroundColor: color.surface, borderRadius: 14, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  cardTitle: { fontSize: 15.5, fontWeight: "600", color: color.text },
  button: { backgroundColor: color.body, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: "hidden", justifyContent: "center" },
  barFill: { height: 6, backgroundColor: color.body },
});
