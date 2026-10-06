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
 * The assessment, on Today: what to do with the day (`action`: the body's
 * response against the market's state), then what it was read from. The
 * body's response, named from three signals, each its 7-day average against
 * its 60-day normal range, and the market's state beside it. How the
 * response is named is one tap away (`/assessment`).
 */
export function AssessmentCard({ d, act, market, habit, nights }: { d: BodyDetail; act: Action | null; market: { state: string; tone: Tone } | null; habit: string | null; nights: number }) {
  const resp = d.response ? BODY[d.response] : null;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={type.label}>Assessment · last 7 days</Text>
        <Pressable onPress={() => router.push("/assessment" as never)} hitSlop={8}>
          <Text style={s.how}>{"How it's read ›"}</Text>
        </Pressable>
      </View>
      {act && resp ? (
        <>
          <View style={{ gap: 4 }}>
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
          <View style={s.table}>
            <Row label="HRV" f={d.hrv} unit="ms" digits={0} tone={TONES.hrv} />
            <Row label="CV of HRV" f={d.cv} unit="%" digits={1} tone={TONES.cv} />
            <Row label="Resting HR" f={d.rhr} unit="bpm" digits={0} tone={TONES.rhr} />
          </View>
        </>
      ) : (
        <Text style={[type.body, { color: color.muted }]}>Needs 30 of the last 60 nights with a reading. {nights} so far.</Text>
      )}
    </View>
  );
}

function Row({ label, f, unit, digits, tone }: { label: string; f: Figure | null; unit: string; digits: number; tone: (a: Arrow) => Tone }) {
  if (!f) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>
        {f.value.toFixed(digits)} {unit}
      </Text>
      <Text style={s.rowRange}>
        {f.low.toFixed(digits)}–{f.high.toFixed(digits)}
      </Text>
      <Text style={[s.rowStatus, { color: toned(tone(f.arrow)) }]}>
        {GLYPH[f.arrow]} {WORD[f.arrow].replace(" normal", "")}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  how: { fontSize: 13.5, fontWeight: "600", color: color.muted },
  actionHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 14, height: 14, borderRadius: 7 },
  actionText: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: "700" },
  size: { fontSize: 16, fontWeight: "600", color: color.text, paddingLeft: 22 },
  habit: { fontSize: 14, lineHeight: 19, fontWeight: "600", paddingLeft: 22, paddingTop: 4 },
  states: { fontSize: 14, color: color.muted },
  stateWord: { fontWeight: "700" },
  table: { gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.s },
  row: { flexDirection: "row", alignItems: "baseline", paddingVertical: 6, gap: space.s },
  rowLabel: { flex: 1.6, fontSize: 14.5, color: color.text },
  rowValue: { flex: 1, fontSize: 15, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  rowRange: { flex: 0.9, fontSize: 13, color: color.faint, fontVariant: ["tabular-nums"] },
  rowStatus: { flex: 1, fontSize: 13.5, fontWeight: "700", textAlign: "right" },
});
