import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { addDays, nightOf } from "./engine/nights";
import { BODY, TONE_COLOR } from "./insight";
import { morning, periods, signed, toneOf, type Journal, type Period } from "./journalread";
import { PHASE_GLYPH, phaseDays, type Phase } from "./moon";
import { color, space, type } from "./theme";

/**
 * The journal as a month: each day's realised result in its square, green or
 * red, and a dot for how the body started that morning (`morning`: the sleep
 * before it), so a run of red days can be read against the nights under them.
 * Days are nights, as everywhere in the journal: a trade after midnight
 * belongs to the evening before. Weeks start on Monday, and each row starts
 * with its week: the ISO week number and what the week realised, opening the
 * week's own summary. A day with trades opens its own page.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Short enough for a square: $147, $1.2K, $15K. */
function compact(x: number): string {
  const a = Math.abs(x);
  const sign = x < -0.5 ? "−" : x > 0.5 ? "+" : "";
  if (a < 1000) return `${sign}$${Math.round(a)}`;
  return `${sign}$${a < 10_000 ? (a / 1000).toFixed(1) : Math.round(a / 1000)}K`;
}

const monthOf = (night: string) => night.slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/** ISO week number: the week that holds the Thursday. */
function isoWeek(monday: string): number {
  const th = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  return 1 + Math.floor((th.getTime() - Date.UTC(th.getUTCFullYear(), 0, 1)) / (7 * 86_400_000));
}

/** The Monday a grid row starts on, though the month may begin partway through it. */
function mondayOf(row: (string | null)[]): string {
  const i = row.findIndex((d) => d !== null);
  return addDays(row[i]!, -i);
}

/** The month's nights in Monday-first rows, null where a row runs past the month. */
function grid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; monthOf(d) === month; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function JournalCalendar({ j }: { j: Journal }) {
  const days = useMemo(() => new Map(periods(j.ledger.fills, "day").map((p) => [p.start, p])), [j]);
  const weeks = useMemo(() => new Map(periods(j.ledger.fills, "week").map((p) => [p.start, p])), [j]);
  const nights = [...days.keys()].sort();
  const first = nights.length ? monthOf(nights[0]) : null;
  const last = nights.length ? monthOf(nights[nights.length - 1]) : null;
  const [month, setMonth] = useState<string | null>(null);
  // Tonight, on the reader's clock: the square outlined as today.
  const [today] = useState(() => nightOf(Date.now() / 1000, -new Date().getTimezoneOffset()));
  const shown = month ?? last;
  // The moon's four phases that fall in the month shown, on the reader's clock.
  const moons = useMemo(() => (shown ? phaseDays(`${shown}-01`, addDays(shiftMonth(`${shown}`, 1) + "-01", -1), -new Date().getTimezoneOffset()) : new Map<string, Phase>()), [shown]);
  if (!shown || !first || !last) return <Text style={[type.small, { color: color.muted }]}>No trades yet.</Text>;

  const inMonth = [...days.values()].filter((p) => monthOf(p.start) === shown);
  const realised = inMonth.reduce((s, p) => s + p.realised, 0);
  const trades = inMonth.reduce((s, p) => s + p.fills.length, 0);
  const green = inMonth.filter((p) => toneOf(p.realised) === "good").length;
  const red = inMonth.filter((p) => toneOf(p.realised) === "bad").length;
  const title = new Date(`${shown}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <View style={{ gap: space.m }}>
      <View style={s.head}>
        <Arrow label="‹" disabled={shown <= first} onPress={() => setMonth(shiftMonth(shown, -1))} />
        <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
          <Text style={s.month}>{title}</Text>
          <Text style={type.small}>
            <Text style={{ color: TONE_COLOR[toneOf(realised)], fontWeight: "700" }}>{Math.abs(realised) >= 1 ? signed(realised) : "$0"}</Text>
            {` · ${trades} trade${trades === 1 ? "" : "s"}`}
            {green || red ? ` · ${green} green, ${red} red` : ""}
          </Text>
        </View>
        <Arrow label="›" disabled={shown >= last} onPress={() => setMonth(shiftMonth(shown, 1))} />
      </View>

      <View style={{ gap: 4 }}>
        <View style={s.row}>
          <Text style={s.weekday}>WK</Text>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={s.weekday}>
              {w}
            </Text>
          ))}
        </View>
        {grid(shown).map((row, r) => {
          const monday = mondayOf(row);
          return (
            <View key={r} style={s.row}>
              <Week monday={monday} p={weeks.get(monday) ?? null} />
              {row.map((night, c) => (night ? <Day key={night} night={night} p={days.get(night) ?? null} j={j} today={night === today} moon={moons.get(night) ?? null} /> : <View key={c} style={s.cell} />))}
            </View>
          );
        })}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={type.small}>
          Dot: the assessment that morning · {PHASE_GLYPH.new} new moon · {PHASE_GLYPH.full} full
        </Text>
        <View style={s.legend}>
          {(
            [
              ["good", "Coping well or Stable"],
              ["watch", "Acute stress"],
              ["bad", "Maladaptation or Fatigue"],
            ] as const
          ).map(([tone, word]) => (
            <View key={tone} style={s.legendItem}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR[tone] }]} />
              <Text style={type.small}>{word}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Day({ night, p, j, today, moon }: { night: string; p: Period | null; j: Journal; today: boolean; moon: Phase | null }) {
  const m = morning(j, night);
  const body = m ? TONE_COLOR[BODY[m.response].tone] : null;
  const tone = p ? toneOf(p.realised) : "neutral";
  const tint = tone === "neutral" ? null : TONE_COLOR[tone];
  return (
    <Pressable
      disabled={!p}
      onPress={() => router.push(`/period?kind=day&start=${night}` as never)}
      style={({ pressed }) => [
        s.cell,
        s.day,
        p && { backgroundColor: tint ? `${tint}33` : color.raised },
        today && { borderColor: color.muted },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={s.dayTop}>
        <Text style={[s.num, !p && { color: color.faint }]}>
          {Number(night.slice(8))}
          {moon ? <Text style={s.moon}>{PHASE_GLYPH[moon]}</Text> : null}
        </Text>
        {body ? <View style={[s.dot, { backgroundColor: body }]} /> : null}
      </View>
      {p ? (
        <Text style={[s.pnl, { color: tint ?? color.muted }]} numberOfLines={1} adjustsFontSizeToFit>
          {tint ? compact(p.realised) : `${p.fills.length}×`}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Week({ monday, p }: { monday: string; p: Period | null }) {
  const tone = p ? toneOf(p.realised) : "neutral";
  return (
    <Pressable
      disabled={!p}
      onPress={() => router.push(`/period?kind=week&start=${monday}` as never)}
      style={({ pressed }) => [s.cell, s.week, pressed && { opacity: 0.6 }]}
    >
      <Text style={s.weekNum}>{isoWeek(monday)}</Text>
      {p ? (
        <Text style={[s.pnl, { color: tone === "neutral" ? color.muted : TONE_COLOR[tone] }]} numberOfLines={1} adjustsFontSizeToFit>
          {tone === "neutral" ? `${p.fills.length}×` : compact(p.realised)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Arrow({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={12} style={({ pressed }) => [s.arrow, pressed && { opacity: 0.6 }]}>
      <Text style={[s.arrowText, disabled && { color: color.line }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center" },
  month: { fontSize: 17, fontWeight: "700", color: color.text },
  arrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  arrowText: { fontSize: 28, color: color.text, lineHeight: 32 },
  row: { flexDirection: "row", gap: 4 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600", color: color.muted },
  cell: { flex: 1, aspectRatio: 0.82 },
  day: { borderRadius: 8, padding: 4, justifyContent: "space-between", borderWidth: 1, borderColor: "transparent" },
  week: { borderRadius: 8, padding: 4, justifyContent: "space-between", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  weekNum: { fontSize: 10, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
  dayTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  num: { fontSize: 12, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"] },
  pnl: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "center" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  moon: { fontSize: 9 },
  legend: { flexDirection: "row", alignItems: "center", columnGap: space.l, rowGap: 4, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
});
