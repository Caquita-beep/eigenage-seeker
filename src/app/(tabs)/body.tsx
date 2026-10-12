import { router } from "expo-router";
import { useMemo } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BandChart } from "../../bandchart";
import { GLYPH, TONES, WORD } from "../../assessmentcard";
import { bodyDetail } from "../../bodyread";
import { metricName, sourceName } from "../../bodyview";
import { useBody } from "../../data";
import type { Arrow } from "../../engine/hrv";
import { TONE_COLOR, type Tone } from "../../insight";
import { color, space, type } from "../../theme";
import { oneOf, usePref } from "../../prefs";
import { ResToggle } from "../../ui";
import { TESTING } from "../../flags";

const open = (path: string) => router.push(path as never);
/**
 * Body: the signals behind the assessment (which is on Today,
 * `assessmentcard.tsx`), each with its chart.
 *
 *   HRV              last night, the 7-day average (baseline) and the normal
 *                    range, with the chart the method is read from
 *   CV               the coefficient of variation of HRV over 7 days, against
 *                    its own normal range
 *   Resting HR       the 7-day average against its normal range
 *
 * Every range is the reader's own (`bodyread.ts`, `engine/hrv.ts`).
 */
export default function Body() {
  const { body, loadSynthetic, busy, error, refresh, forget, readings } = useBody();
  const d = useMemo(() => (body ? bodyDetail(body) : null), [body]);
  // The charts' window: a value a day, from one week to three months. Remembered (`prefs.ts`).
  const [daysRaw, setDays] = usePref<"7" | "14" | "30" | "90">("bodytab:window", "30");
  const days = oneOf(daysRaw, ["7", "14", "30", "90"], "30");

  if (!body || !d) {
    return (
      <SafeAreaView style={s.screen} edges={["top"]}>
        <View style={s.intro}>
          <Text style={type.label}>Body</Text>
          <Text style={type.title}>No health data yet.</Text>
          <Text style={[type.body, { color: color.muted }]}>{TESTING ? "Connect it on the Today tab, or try it with generated data." : "Connect it on the Today tab."}</Text>
          {TESTING ? (
            <Pressable style={({ pressed }) => [s.button, (pressed || busy) && { opacity: 0.6 }]} onPress={loadSynthetic} disabled={busy}>
              <Text style={s.buttonText}>Load synthetic data</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const lastRhr = body.rhr.at(-1)?.[1];
  const synthetic = body.source === "whoop-synthetic";
  const strap = body.source === "strap";
  const lastHrv = body.hrv.at(-1)?.[1];
  // Taken on waking (a strap, or Apple Watch morning sessions), not during the night.
  const lastLabel = body.timing === "morning" ? "Last reading" : "Last night";
  const confirmRemove = () =>
    synthetic && readings.length
      ? Alert.alert("Remove synthetic data?", "Back to your strap readings.", [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", onPress: () => void forget() },
        ])
      : Alert.alert("Remove health data?", "It is deleted from this phone. Connect it again on the Today tab.", [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => void forget() },
        ]);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          body.source === "health-connect" ? <RefreshControl refreshing={busy} onRefresh={refresh} colors={[color.body]} progressBackgroundColor={color.raised} /> : undefined
        }
      >
        <View style={s.top}>
          <Text style={type.title}>Body</Text>
          <Text style={type.label}>{dateLabel}</Text>
        </View>

        {error ? <Text style={[type.small, { color: color.below }]}>{error}</Text> : null}

        {/* The one way to measure: a strap reading (`reading.tsx`). */}
        <Pressable onPress={() => open("/reading")} style={({ pressed }) => [s.measure, pressed && { opacity: 0.8 }]}>
          <Text style={s.measureText}>Measure HRV</Text>
        </Pressable>

        <ResToggle
          options={[
            { key: "7", label: "1W" },
            { key: "14", label: "2W" },
            { key: "30", label: "1M" },
            { key: "90", label: "3M" },
          ]}
          value={days}
          onChange={setDays}
        />

        {/* ── HRV ────────────────────────────────────────────────── */}
        <Pressable onPress={() => open("/chart/hrv")} style={s.card}>
          <View style={s.cardHead}>
            <Text style={type.label}>{metricName(body)}</Text>
            {d.hrv ? <Status a={d.hrv.arrow} tone={TONES.hrv(d.hrv.arrow)} /> : null}
          </View>
          <View style={s.figs}>
            <Fig label={lastLabel} value={lastHrv !== undefined ? lastHrv.toFixed(0) : "–"} unit="ms" />
            <Fig label="7-day average" value={d.hrv ? d.hrv.value.toFixed(0) : "–"} unit="ms" strong />
            <Fig label="Normal range" value={d.hrv ? `${d.hrv.low.toFixed(0)}–${d.hrv.high.toFixed(0)}` : "–"} unit="ms" />
          </View>
          <BandChart points={d.charts.hrv.slice(-Number(days))} tint={TONE_COLOR.good} />
        </Pressable>

        {/* ── CV ─────────────────────────────────────────────────── */}
        <Pressable onPress={() => open("/chart/hrvcv")} style={s.card}>
          <View style={s.cardHead}>
            <Text style={type.label}>CV · coefficient of variation</Text>
            {d.cv ? <Status a={d.cv.arrow} tone={TONES.cv(d.cv.arrow)} /> : null}
          </View>
          <View style={s.figs}>
            <Fig label="Last 7 days" value={d.cv ? d.cv.value.toFixed(1) : "–"} unit="%" strong />
            <Fig label="Normal range" value={d.cv ? `${d.cv.low.toFixed(1)}–${d.cv.high.toFixed(1)}` : "–"} unit="%" />
          </View>
          <BandChart points={d.charts.cv.slice(-Number(days))} tint={TONE_COLOR.watch} digits={1} />
        </Pressable>

        {/* ── Resting heart rate ─────────────────────────────────── */}
        {/* Shown from the first value, like HRV and CV; the average and range fill in after a week. */}
        {body.rhr.length ? (
          <Pressable onPress={() => open("/chart/rhr")} style={s.card}>
            <View style={s.cardHead}>
              <Text style={type.label}>Resting heart rate</Text>
              {d.rhr ? <Status a={d.rhr.arrow} tone={TONES.rhr(d.rhr.arrow)} /> : null}
            </View>
            <View style={s.figs}>
              <Fig label={lastLabel} value={lastRhr !== undefined ? lastRhr.toFixed(0) : "–"} unit="bpm" />
              <Fig label="7-day average" value={d.rhr ? d.rhr.value.toFixed(0) : "–"} unit="bpm" strong />
              <Fig label="Normal range" value={d.rhr ? `${d.rhr.low.toFixed(0)}–${d.rhr.high.toFixed(0)}` : "–"} unit="bpm" />
            </View>
            <BandChart points={d.charts.rhr.slice(-Number(days))} tint={TONE_COLOR.bad} />
          </Pressable>
        ) : null}

        {/* Data from elsewhere: where from, read it again, remove it. A strap's readings are deleted on the Readings screen. */}
        {!strap ? (
          <View style={s.footer}>
            <Text style={[type.small, synthetic && { color: color.synthetic }]}>{synthetic ? "Synthetic data" : `From ${sourceName(body)}`}</Text>
            {!synthetic ? <FooterLink label={body.source === "apple-health" ? "Re-import" : "Refresh"} onPress={refresh} disabled={busy} /> : null}
            <FooterLink label="Remove" onPress={confirmRemove} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function FooterLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => (pressed || disabled) && { opacity: 0.5 }}>
      <Text style={s.footerLink}>{label}</Text>
    </Pressable>
  );
}

function Status({ a, tone }: { a: Arrow; tone: Tone }) {
  return <Text style={[s.status, { color: tone === "neutral" ? color.muted : TONE_COLOR[tone] }]}>{GLYPH[a]} {WORD[a]}</Text>;
}

function Fig({ label, value, unit, strong }: { label: string; value: string; unit: string; strong?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.small}>{label}</Text>
      <Text style={[s.figValue, strong && { fontSize: 24 }]}>
        {value}
        <Text style={s.figUnit}> {unit}</Text>
      </Text>
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
  status: { fontSize: 14, fontWeight: "700" },
  figs: { flexDirection: "row", gap: space.s },
  figValue: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figUnit: { fontSize: 13, fontWeight: "400", color: color.muted },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
  measure: { backgroundColor: color.body, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  measureText: { color: color.bg, fontSize: 15, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space.l, paddingTop: space.s },
  footerLink: { fontSize: 13, fontWeight: "600", color: color.muted },
  button: { backgroundColor: color.body, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  buttonText: { color: color.bg, fontSize: 15, fontWeight: "600" },
});
