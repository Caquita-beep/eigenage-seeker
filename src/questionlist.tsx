import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { say, SHORT } from "./answers";
import type { SeriesKey } from "./engine/hypotheses";
import type { Answer } from "./exposure";
import { TONE_COLOR } from "./insight";
import { LINKS, readLink, type LinkRead } from "./linkread";
import { color, space, type } from "./theme";

/**
 * Every question the app asks of the reader's history, one closed card each,
 * most important first. A card shows its name and its verdict; the question,
 * what came out, the statistics and the chart are behind a tap.
 *
 * Importance, in order:
 *   1. what the history shows: a finding, then a hint (an exploratory
 *      question that came out clearly), then a link both ways, then no link,
 *      then still learning, then waiting for data
 *   2. the main questions before the exploratory ones
 *   3. the clearer result first: the effect against half its interval; for
 *      one still learning, how far along it is
 */

type Data = Partial<Record<SeriesKey, Map<string, number>>> | null;
type Kind = "found" | "hint" | "partial" | "two-way" | "none" | "learning" | "missing";

const RANK: Record<Kind, number> = { found: 0, hint: 1, partial: 2, "two-way": 3, none: 4, learning: 5, missing: 6 };

interface Item {
  a: Answer;
  read: LinkRead;
  kind: Kind;
  word: string;
  title: string;
  strength: number;
}

const titleOf = (a: Answer) => LINKS.find((l) => l.id === a.h.id)?.title ?? (a.h.subject && a.h.id.startsWith("coin-") ? `${a.h.subject} → your body` : (SHORT[a.h.id] ?? a.h.question));

function itemOf(a: Answer, data: Data): Item {
  const read = readLink(a, undefined, data);
  const exploratory = a.h.tier !== "primary";
  // An exploratory question that came out clearly is a hint until it is confirmed, never a finding.
  const kind: Kind = read.status === "found" && exploratory ? "hint" : (read.status as Kind);
  const r = a.r;
  const strength =
    r.status === "result" ? Math.abs(r.effect) / Math.max(1e-9, (r.interval[1] - r.interval[0]) / 2) : r.status === "collecting" ? r.have / Math.max(1, r.need) : 0;
  return { a, read, kind, word: kind === "hint" ? "Hint" : read.word, title: titleOf(a), strength };
}

/** All the questions, most important first. */
export function rankQuestions(answers: Answer[], data: Data): Item[] {
  return answers
    .map((a) => itemOf(a, data))
    .sort((x, y) => RANK[x.kind] - RANK[y.kind] || (x.a.h.tier === "primary" ? 0 : 1) - (y.a.h.tier === "primary" ? 0 : 1) || y.strength - x.strength);
}

export function QuestionList({ items }: { items: Item[] }) {
  return (
    <View style={{ gap: space.s }}>
      {items.map((x) => (
        <QuestionCard key={x.a.h.id} x={x} />
      ))}
    </View>
  );
}

const lit = (k: Kind) => k === "found" || k === "hint" || k === "partial";

function QuestionCard({ x }: { x: Item }) {
  const [open, setOpen] = useState(false);
  const tint = lit(x.kind) ? TONE_COLOR[x.read.tone === "neutral" ? "watch" : x.read.tone] : color.faint;
  const said = say(x.a);
  const primary = x.a.h.tier === "primary";
  return (
    <View style={s.card}>
      <Pressable onPress={() => setOpen((o) => !o)} style={({ pressed }) => [s.head, pressed && { opacity: 0.7 }]}>
        <View style={[s.dot, { backgroundColor: lit(x.kind) ? tint : "transparent", borderColor: tint }]} />
        <Text style={[s.title, !lit(x.kind) && { color: color.muted }]} numberOfLines={open ? undefined : 2}>
          {x.title}
        </Text>
        <Text style={[s.word, { color: lit(x.kind) ? tint : color.faint }]}>{x.word}</Text>
        <Text style={s.chevron}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View style={s.body}>
          <Text style={s.question}>{x.a.h.question}</Text>
          <Text style={s.line}>{x.read.line}</Text>
          {said.detail ? <Text style={s.detail}>{said.detail}</Text> : null}
          <Text style={s.detail}>{primary ? "Main question: the main ones share a 5% chance of a false alarm." : "Exploratory: a hint until confirmed."}</Text>
          <Pressable onPress={() => router.push(`/link/${encodeURIComponent(x.a.h.id)}` as never)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
            <Text style={s.more}>See the chart ›</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", alignItems: "center", gap: space.s, padding: space.l },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 1.5 },
  title: { flex: 1, fontSize: 15.5, fontWeight: "700", color: color.text },
  word: { fontSize: 14, fontWeight: "700" },
  chevron: { fontSize: 12, color: color.faint, width: 12, textAlign: "center" },
  body: { gap: space.s, paddingHorizontal: space.l, paddingBottom: space.l, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.m },
  question: { ...type.small, color: color.muted },
  line: { fontSize: 15, lineHeight: 21, color: color.text },
  detail: { fontSize: 12.5, lineHeight: 18, color: color.faint },
  more: { fontSize: 14, fontWeight: "600", color: color.muted },
});
