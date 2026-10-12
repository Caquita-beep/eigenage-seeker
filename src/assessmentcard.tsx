import { router, useIsFocused } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BodyDetail, Figure } from "./bodyread";
import { patternOf, PATTERNS } from "./breath";
import { breathAdvice } from "./breathadvice";
import { BreathMark } from "./breather";
import { FIRM_NIGHTS, type Arrow, type Response } from "./engine/hrv";
import { usePref } from "./prefs";
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
 * with where it sits against its 60-day normal range. The action and the
 * states open every morning's assessment as a chart (`/assessments`), each
 * signal its own chart (`/chart/…`); how the response is named is one tap
 * away (`/assessment`). Last, what to do with breathing given the response
 * (`breathadvice.ts`), opening Breathe.
 */
export function AssessmentCard({
  d,
  act,
  market,
  habit,
  nights,
  stale,
  onPreview,
}: {
  d: BodyDetail;
  act: Action | null;
  market: { state: string; tone: Tone } | null;
  /** The one line under the action: the tested habit, or where the trading works against the body. */
  habit: string | null;
  nights: number;
  /** The morning of the newest reading, when it is older than yesterday's: the assessment is that day's, not today's. */
  stale: string | null;
  /** Until the strap's mornings are enough: the app filled with synthetic data, to see what is coming. */
  onPreview?: () => void;
}) {
  const resp = d.response ? BODY[d.response] : null;
  // How far the read has got (`bodyread.ts`): said once, under the figures, until it is firm.
  const progress =
    d.stage === "learning"
      ? "Your body is read from your next morning on. Until then, this is the market's."
      : d.stage === "quick"
        ? `First read: this morning against your ${nights - 1} before it. Weekly from 10 mornings, firm at ${FIRM_NIGHTS}.`
        : d.stage === "early"
          ? `Early read: your normal is from ${nights} mornings so far, firm at ${FIRM_NIGHTS}.`
          : null;
  const label = stale !== null ? `Assessment · last reading ${stale}` : d.stage === "quick" ? "Assessment · this morning" : d.stage === "learning" ? "Assessment · today" : "Assessment · last 7 days";
  return (
    <View style={s.card}>
      <Text style={[type.label, s.center, stale !== null && { color: TONE_COLOR.watch }]}>{label}</Text>
      {act ? (
        <>
          <Pressable onPress={() => router.push("/assessments" as never)} style={({ pressed }) => [s.history, pressed && { opacity: 0.7 }]}>
          <View style={s.action}>
            <View style={s.actionHead}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR[act.tone] }]} />
              <Text style={[s.actionText, { color: TONE_COLOR[act.tone] }]}>{act.headline}</Text>
            </View>
            <Text style={s.size}>{act.sizeLine}</Text>
            {habit ? <Text style={[s.habit, { color: TONE_COLOR.watch }]}>{habit}</Text> : null}
          </View>
          <Text style={s.states}>
            Body <Text style={[s.stateWord, { color: resp ? toned(resp.tone) : color.muted }]}>{resp ? resp.state : "Learning"}</Text>
            {market ? (
              <>
                {"   ·   Market "}
                <Text style={[s.stateWord, { color: toned(market.tone) }]}>{market.state}</Text>
              </>
            ) : null}
          </Text>
          </Pressable>
          {d.hrv || d.cv || d.rhr ? (
            <View style={s.signals}>
              <Signal label="HRV" f={d.hrv} unit="ms" digits={0} tone={TONES.hrv} chart="hrv" />
              <Signal label="CV" f={d.cv} unit="%" digits={1} tone={TONES.cv} chart="hrvcv" />
              <Signal label="Resting HR" f={d.rhr} unit="bpm" digits={0} tone={TONES.rhr} chart="rhr" />
            </View>
          ) : null}
          {progress ? <Text style={[type.small, s.center]}>{progress}</Text> : null}
          {progress && onPreview ? (
            <Pressable onPress={onPreview} hitSlop={8} style={{ alignSelf: "center" }}>
              <Text style={[s.how, { color: color.synthetic }]}>See it with synthetic data ›</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push("/assessment" as never)} hitSlop={8} style={{ alignSelf: "center" }}>
            <Text style={s.how}>{"How it's read ›"}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[type.body, s.center, { color: color.muted }]}>Your body is read from your second morning on; the market is still loading.</Text>
          {onPreview ? (
            <Pressable onPress={onPreview} hitSlop={8} style={{ alignSelf: "center" }}>
              <Text style={[s.how, { color: color.synthetic }]}>See it with synthetic data ›</Text>
            </Pressable>
          ) : null}
        </>
      )}
      <BreatheRow response={d.response} />
    </View>
  );
}

/** Breathing for the day: when and how long, with the pattern last chosen on Breathe, moving at its pace. */
function BreatheRow({ response }: { response: Response | null }) {
  const [id] = usePref<string>("breathe:pattern", "resonance");
  const p = patternOf(id) ?? PATTERNS[0];
  const a = breathAdvice(response);
  const focused = useIsFocused();
  const tint = a.strained ? color.body : color.muted;
  return (
    <Pressable onPress={() => router.push("/breathe" as never)} hitSlop={4} style={({ pressed }) => [s.breathe, pressed && { opacity: 0.7 }]}>
      <BreathMark pattern={p} tint={tint} still={!focused} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.breatheWhen}>Breathe · {a.when.toLowerCase()}</Text>
        <Text style={type.small}>
          {p.name}
          {a.also ? `, ${a.also}` : ""}
        </Text>
      </View>
      <Text style={[s.breatheMin, { color: tint }]}>{a.min} min ›</Text>
    </Pressable>
  );
}

/** One signal, large: its 7-day average, then where that sits against its normal range. Opens its chart. */
function Signal({ label, f, unit, digits, tone, chart }: { label: string; f: Figure | null; unit: string; digits: number; tone: (a: Arrow) => Tone; chart: string }) {
  return (
    <Pressable onPress={() => router.push(`/chart/${chart}` as never)} style={({ pressed }) => [s.signal, pressed && { opacity: 0.6 }]}>
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
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  center: { textAlign: "center" },
  how: { fontSize: 13.5, fontWeight: "600", color: color.muted },
  history: { gap: space.m },
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
  breathe: { flexDirection: "row", alignItems: "center", gap: space.m, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.m },
  breatheWhen: { fontSize: 15, fontWeight: "600", color: color.text },
  breatheMin: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
