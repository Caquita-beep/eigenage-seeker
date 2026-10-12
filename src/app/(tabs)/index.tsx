import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { bodyDetail, dayLabel, lastReading } from "../../bodyread";
import { useBody, useExposure, useMarket, useWalletData } from "../../data";
import { AssessmentCard } from "../../assessmentcard";
import { action, bodyPillar, marketPillar, tradingPillar } from "../../insight";
import { JournalCalendar } from "../../journalcalendar";
import { sides } from "../../linkread";
import { usePref } from "../../prefs";
import { useJournal } from "../../journalread";
import { LoadCard, MixCard } from "../../sportcards";
import { useSport } from "../../sportread";
import { thisMorning } from "../../readings";
import { color, space, type } from "../../theme";
import { TESTING } from "../../flags";

const open = (path: string) => router.push(path as never);

/**
 * Today: the dashboard. The assessment (what to do with the day, and the
 * body and market it was read from, and breathing for the day) first, always;
 * then the journal's month, and the week's trading load and intensity, shut
 * to their numbers until tapped (`sportcards.tsx`). The balance is on Wallet.
 */

export default function Today() {
  const { body, busy, stage, fraction, error, loadSynthetic, readings } = useBody();
  const { view: market } = useMarket();
  const { view: wallet } = useWalletData();
  const { answers } = useExposure();

  const bp = useMemo(() => (body ? bodyPillar(body) : null), [body]);
  const bd = useMemo(() => (body ? bodyDetail(body) : null), [body]);
  const last = useMemo(() => (body ? lastReading(body) : null), [body]);
  // This morning's strap reading (`readings.ts`): always on Today, the first thing seen on waking.
  const am = thisMorning(readings);
  const [minutes] = usePref<number>("reading:minutes", 1);
  const mp = useMemo(() => (market ? marketPillar(market) : null), [market]);
  const tp = useMemo(() => (wallet ? tradingPillar(wallet) : null), [wallet]);
  const act = useMemo(() => action(bp, mp, tp), [bp, mp, tp]);
  const { journal: j } = useJournal();
  const sport = useSport();
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
          {/* The body comes from a chest strap only: read by this phone, with no company's cloud in between. */}
          <Text style={[type.body, { color: color.muted }]}>Your heart, read by your phone. No company in between, and everything stays here.</Text>
          <Connect title="Chest strap" steps="Polar H10 or any Bluetooth heart-rate strap. One minute each morning, on waking." button="Take a morning reading" onPress={() => open("/reading")} disabled={busy} />
          {TESTING ? <Connect title="No wearable yet?" steps="Try it with generated data." button="Load synthetic data" onPress={loadSynthetic} disabled={busy} /> : null}
          {busy ? <Working stage={stage} fraction={fraction} /> : null}
          {error ? <Text style={[type.small, { color: color.below }]}>{error}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });


  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.top}>
          <Text style={type.title}>Today</Text>
          <Text style={type.label}>{dateLabel}</Text>
        </View>

        <MorningCard am={am} minutes={minutes} />

        {bd ? (
          <AssessmentCard
            d={bd}
            act={act}
            market={mp}
            habit={habit ?? act?.lines[0] ?? null}
            nights={body.hrv.length}
            stale={last?.stale ? dayLabel(last.morning) : null}
            onPreview={TESTING && body.source === "strap" ? loadSynthetic : undefined}
          />
        ) : null}

        {j ? (
          <View style={s.card}>
            <Pressable onPress={() => open("/journal")} style={s.cardHead} hitSlop={8}>
              <Text style={type.label}>Journal</Text>
              <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>Totals ›</Text>
            </Pressable>
            <JournalCalendar j={j} />
          </View>
        ) : null}

        {sport ? (
          <>
            <LoadCard tw={sport.tw} weeks={sport.weeks} rhythm={sport.rhythm} heavy={sport.heavy} />
            <MixCard mixes={sport.mixes} zones={sport.zones} rest={sport.rest} />
          </>
        ) : null}

        <Pressable onPress={() => open("/about")} hitSlop={8} style={{ alignSelf: "center" }}>
          <Text style={s.about}>About Heart Alpha</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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

/** This morning's reading: the button to take it, or what it read. */
function MorningCard({ am, minutes }: { am: ReturnType<typeof thisMorning>; minutes: number }) {
  if (am.kind === "done") {
    return (
      <Pressable onPress={() => open("/readings")} style={({ pressed }) => [s.card, s.prompt, { borderColor: color.line }, pressed && { opacity: 0.8 }]}>
        <View style={{ gap: 2 }}>
          <Text style={type.label}>Morning reading</Text>
          <Text style={s.cardTitle}>
            {am.r.rmssd.toFixed(0)} ms<Text style={[type.small, { fontWeight: "400" }]}> · {am.r.hr.toFixed(0)} bpm · {new Date(am.r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</Text>
          </Text>
        </View>
        <Text style={[s.cardState, { color: color.muted, fontSize: 15 }]}>Readings ›</Text>
      </Pressable>
    );
  }
  // The morning over without a reading: nothing to do about it now, so nothing shown.
  if (am.kind === "missed") return null;
  return (
    <Pressable onPress={() => open("/reading")} style={({ pressed }) => [s.card, s.prompt, pressed && { opacity: 0.8 }]}>
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text style={s.cardTitle}>Take this morning&apos;s reading</Text>
        <Text style={type.small}>On waking, after the bathroom. Sit still with your strap.</Text>
      </View>
      <Text style={[s.cardState, { color: color.body, fontSize: 15 }]}>{`${minutes} min ›`}</Text>
    </Pressable>
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
  prompt: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderColor: color.body },
  connect: { backgroundColor: color.surface, borderRadius: 14, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  cardTitle: { fontSize: 15.5, fontWeight: "600", color: color.text },
  about: { fontSize: 14, fontWeight: "600", color: color.faint, paddingVertical: space.s },
  button: { backgroundColor: color.body, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: "hidden", justifyContent: "center" },
  barFill: { height: 6, backgroundColor: color.body },
});
