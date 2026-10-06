import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useExposure } from "../../data";
import { TONE_COLOR, type Tone } from "../../insight";
import { DOWN, UP } from "../../indicators";
import { evidenceFor, linkTitle, readLink } from "../../linkread";
import { ProChart, type Pane } from "../../prochart";
import { color, space, type } from "../../theme";

const toneColor = (t: Tone) => (t === "neutral" ? color.muted : TONE_COLOR[t]);
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

/**
 * One link, with its evidence: the body's series on top and what it was
 * tested against underneath, on one time axis, so the reader can see the two
 * move (or not) for themselves. Then the verdict in plain words, the question
 * as it was written down before any data, and the statistics.
 */
export default function LinkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { answers, data } = useExposure();
  const [touching, setTouching] = useState(false);
  const a = answers?.find((x) => x.h.id === id) ?? null;
  const read = a ? readLink(a, undefined, data) : null;

  const chart = useMemo(() => {
    const q = answers?.find((x) => x.h.id === id)?.h;
    const ev = q ? evidenceFor(q) : undefined;
    if (!data || !ev) return null;
    const top = data[ev.body];
    const bottom = data[ev.other];
    if (!top?.size || !bottom?.size) return null;
    const days = [...new Set([...top.keys(), ...bottom.keys()])].sort().slice(ev.weekly ? -52 : -240);
    const pct = id === "underwater-hrv" || ev.other === "wallet:share" || ev.other === "wallet:result";
    // A day's move, already in percent: green up, red down.
    const move = ev.other === "wallet:pnl" || ev.other.startsWith("market:coin:");
    const otherValues = days.map((d) => bottom.get(d) ?? null);
    const main: Pane = {
      key: "main",
      height: 190,
      lines: [{ key: "body", label: ev.bodyLabel, values: days.map((d) => top.get(d) ?? null), color: color.body, kind: ev.weekly ? "line" : "dots", width: 1.6 }],
      format: (v) => (ev.body === "health:ln" ? `${Math.round(Math.exp(v))} ms` : v.toFixed(1)),
    };
    const sub: Pane = {
      key: "other",
      title: ev.otherLabel,
      height: 110,
      lines: [
        {
          key: "other",
          label: ev.otherLabel,
          values: otherValues,
          color: id === "underwater-hrv" ? color.wallet : color.market,
          kind: ev.weekly ? "line" : "bars",
          barColors: move ? otherValues.map((v) => ((v ?? 0) >= 0 ? UP : DOWN)) : undefined,
        },
      ],
      guides: id === "underwater-hrv" || move ? [0] : undefined,
      format: (v) => (move ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%` : pct ? `${(100 * v).toFixed(0)}%` : v.toFixed(1)),
    };
    return { t: days.map(dayMs), main, sub, weekly: ev.weekly };
  }, [answers, data, id]);

  const title = a ? linkTitle(a.h) : "";
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title }} />
      {read ? (
        <View style={s.pad}>
          <Text style={[s.word, { color: toneColor(read.tone) }]}>{read.word}</Text>
          <Text style={[type.body, { color: color.text }]}>{read.line}</Text>
        </View>
      ) : (
        <Text style={[type.small, s.pad]}>Reading your history…</Text>
      )}
      {chart ? (
        <View style={s.chart}>
          <ProChart t={chart.t} main={chart.main} subs={[chart.sub]} time={chart.weekly ? "weekly" : "daily"} initialCount={chart.weekly ? 30 : 120} onInteraction={setTouching} />
        </View>
      ) : null}
      {a ? (
        <View style={[s.pad, { gap: space.m }]}>
          <View style={{ gap: 4 }}>
            <Text style={type.label}>The question</Text>
            <Text style={[type.body, { color: color.muted }]}>{a.h.question}</Text>
            <Text style={s.caption}>
              {a.h.tier === "primary"
                ? "Written down before any data was seen. One of the three main questions: they share a 5% chance of a false alarm."
                : a.h.confidence !== undefined
                  ? "Exploratory, and asked of each coin you hold: together they share a 5% chance of a false alarm."
                  : "Exploratory: a hint until confirmed."}
            </Text>
          </View>
          {read?.detail ? (
            <View style={{ gap: 4 }}>
              <Text style={type.label}>The numbers</Text>
              <Text style={s.caption}>{read.detail}</Text>
            </View>
          ) : null}
          <Text style={s.caption}>Drag to move through time, pinch to zoom, tap for the crosshair. Two lines moving together is not proof on its own; the verdict above is the test.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { paddingVertical: space.l, gap: space.l, paddingBottom: space.xxl },
  pad: { paddingHorizontal: space.l, gap: space.xs },
  word: { fontSize: 24, fontWeight: "700" },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
});
