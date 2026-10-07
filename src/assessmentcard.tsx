import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BodyDetail, Figure } from "./bodyread";
import type { Arrow } from "./engine/hrv";
import { BODY, TONE_COLOR, type Action, type Tone } from "./insight";
import { color, space, type } from "./theme";

export const GLYPH: Record<Arrow, string> = { up: "↑", flat: "→", down: "↓" };
export const WORD: Record<Arrow, string> = { up: "above normal", flat: "within normal", down: "below normal" };

/** What each signal's direction means: HRV up is good; resting heart rate and CV up are the warnings. */
export const TONES = {
  hrv: (a: Arrow): Tone => (a === "down" ? "bad" : a === "up" ? "good" : "neutral"),
  cv: (a: Arrow): Tone => (a === "up" ? "watch" : a === "down" ? "good" : "neutral"),
  rhr: (a: Arrow): Tone => (a === "up" ? "bad" : a === "down" ? "good" : "neutral"),
};

const toned = (t: Tone) => (t === "neutral" ? color.muted : TONE_COLOR[t]);

/**
 * The assessment, on Today, centred: what to do with the day (`action`: the
 * body's response against the market's state), the two states it was read
 * from, and the body's three signals as large figures, each its 7-day average
 * with where it sits against its 60-day normal range. How the response is
 * named is one tap away (`/assessment`).
 */
export function AssessmentCard({ d, act, market, habit, nights }: { d: BodyDetail; act: Action | null; market: { state: string; tone: Tone } | null; habit: string | null; nights: number }) {
  const resp = d.response ? BODY[d.response] : null;
  return (
    <View style={s.card}>
      <Text style={[type.label, s.center]}>Assessment · last 7 days</Text>
      {act && resp ? (
        <>
          <View style={s.action}>
            <View style={s.actionHead}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR[act.tone] }]} />
              <Text style={[s.actionText, { color: TONE_COLOR[act.tone] }]}>{act.headline}</Text>
            </View>
            <Text style={s.size}>{act.sizeLine}</Text>
            {habit ? <Text style={[s.habit, { color: TONE_COLOR.watch }]}>{habit}</Text> : null}
          </View>
          <Text style={s.states}>
            Body <Text style={[s.stateWord, { color: toned(resp.tone) }]}>{resp.state}</Text>
            {market ? (
              <>
                {"   ·   Market "}
                <Text style={[s.stateWord, { color: toned(market.tone) }]}>{market.state}</Text>
              </>
            ) : null}
          </Text>
          <View style={s.signals}>
            <Signal label="HRV" f={d.hrv} unit="ms" digits={0} tone={TONES.hrv} />
            <Signal label="CV" f={d.cv} unit="%" digits={1} tone={TONES.cv} />
            <Signal label="Resting HR" f={d.rhr} unit="bpm" digits={0} tone={TONES.rhr} />
          </View>
          <Pressable onPress={() => router.push("/assessment" as never)} hitSlop={8} style={{ alignSelf: "center" }}>
            <Text style={s.how}>{"How it's read ›"}</Text>
          </Pressable>
        </>
      ) : (
        <Text style={[type.body, s.center, { color: color.muted }]}>Needs 30 of the last 60 nights with a reading. {nights} so far.</Text>
      )}
    </View>
  );
}

/** One signal, large: its 7-day average, then where that sits against its normal range. */
function Signal({ label, f, unit, digits, tone }: { label: string; f: Figure | null; unit: string; digits: number; tone: (a: Arrow) => Tone }) {
  return (
    <View style={s.signal}>
      <Text style={s.signalLabel}>{label}</Text>
      <Text style={s.signalValue}>
        {f ? f.value.toFixed(digits) : "–"}
        <Text style={s.signalUnit}> {unit}</Text>
      </Text>
      {f ? (
        <>
          <Text style={[s.signalStatus, { color: toned(tone(f.arrow)) }]}>
            {GLYPH[f.arrow]} {WORD[f.arrow].replace(" normal", "")}
          </Text>
          <Text style={s.signalRange}>
            {f.low.toFixed(digits)}–{f.high.toFixed(digits)}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  center: { textAlign: "center" },
  how: { fontSize: 13.5, fontWeight: "600", color: color.muted },
  action: { alignItems: "center", gap: 4 },
  actionHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 14, height: 14, borderRadius: 7 },
  actionText: { fontSize: 24, lineHeight: 30, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  size: { fontSize: 16, fontWeight: "600", color: color.text, textAlign: "center" },
  habit: { fontSize: 14, lineHeight: 19, fontWeight: "600", textAlign: "center", paddingTop: 4 },
  states: { fontSize: 14.5, color: color.muted, textAlign: "center" },
  stateWord: { fontWeight: "700" },
  signals: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.m },
  signal: { flex: 1, alignItems: "center", gap: 2 },
  signalLabel: { fontSize: 12.5, fontWeight: "600", color: color.muted },
  signalValue: { fontSize: 32, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  signalUnit: { fontSize: 14, fontWeight: "600", color: color.muted, letterSpacing: 0 },
  signalStatus: { fontSize: 14, fontWeight: "700" },
  signalRange: { fontSize: 12, color: color.faint, fontVariant: ["tabular-nums"] },
});
