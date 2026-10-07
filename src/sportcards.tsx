import { router } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Line, Polyline, Rect } from "react-native-svg";
import { DOWN, UP } from "./indicators";
import { TONE_COLOR } from "./insight";
import type { Condition, LoadWeek, Mix, Side, Split, Strain, Zone } from "./sport";
import { MIN_HEADLINE } from "./sport";
import { color, space, type } from "./theme";
import type { TradingWeek } from "./walletread";

/**
 * The sport cards on Insights (`sport.ts`): the trading load, the intensity
 * mix, and the conditions the reader trades best and worst in. The cards
 * carry numbers and short labels only; every word they group by is defined
 * once, on How Insights are read (`app/terms.tsx`), behind each card's ⓘ.
 */

const pct = (x: number) => `${Math.round(100 * x)}%`;
const move = (x: number) => (Math.abs(x) < 0.0005 ? "0.0%" : `${x > 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`);
/** Up or down, or no colour for a result that rounds to nothing. */
const upDown = (x: number | null) => (x === null || Math.abs(x) < 0.0005 ? null : { color: x > 0 ? UP : DOWN });
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)} ms`);

export const ZONE: Record<Zone, { word: string; tint: string }> = {
  easy: { word: "Easy", tint: TONE_COLOR.good },
  moderate: { word: "Moderate", tint: TONE_COLOR.watch },
  hard: { word: "Hard", tint: TONE_COLOR.bad },
};

/** The three strains, as a day's list names them. */
export const STRAIN: Record<Strain, string> = { size: "big size", late: "late", move: "a big SOL move" };

/** "Big size and late". */
export const strainList = (xs: Strain[]) => {
  const w = xs.map((x) => STRAIN[x]);
  const t = w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : (w[0] ?? "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The card's width inside the screen's and the card's own padding. */
const useInner = () => useWindowDimensions().width - 2 * space.l - 2 * space.l;

// ── Load ──────────────────────────────────────────────────────────────────

const WEIGHT = { heavier: { word: "Heavier", tone: "watch" }, usual: { word: "Usual", tone: "good" }, lighter: { word: "Lighter", tone: "good" } } as const;

export function LoadCard({ tw, weeks, rhythm, heavy }: { tw: TradingWeek; weeks: LoadWeek[]; rhythm: { streak: number; rest: number } | null; heavy: { heavy: Side; other: Side; weeks: number } | null }) {
  const w = useInner();
  const h = 96;
  const top = Math.max(...weeks.map((x) => Math.max(x.load, x.chronic ?? 0)), 0.01);
  const slot = w / Math.max(weeks.length, 1);
  const bar = Math.max(4, slot - 6);
  const y = (v: number) => h - (v / top) * (h - 4);
  const chronic = weeks
    .map((x, i) => (x.chronic === null ? null : `${(i * slot + slot / 2).toFixed(1)},${y(x.chronic).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
  const word = tw.weight ? WEIGHT[tw.weight] : null;
  return (
    <Pressable onPress={() => router.push("/chart/load" as never)} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
      <Head label="Trading load" right={<Text style={[s.state, { color: word ? TONE_COLOR[word.tone] : color.muted }]}>{word ? word.word : "Learning"} ›</Text>} />
      <View style={s.figs}>
        <Fig label="Last 7 days" value={pct(tw.moved)} note="of wallet moved" />
        <Fig label="Against 4 weeks" value={tw.ratio !== null ? `${tw.ratio.toFixed(1)}×` : "–"} note={tw.usual !== null ? `usual ${pct(tw.usual)}` : "needs 5 weeks"} />
        <Fig label="Rest days" value={rhythm ? `${rhythm.rest} of 7` : "–"} note={rhythm && rhythm.streak > 1 ? `${rhythm.streak} days in a row` : "last 7 nights"} />
      </View>
      {weeks.length > 1 ? (
        <View style={{ gap: 4 }}>
          <Svg width={w} height={h}>
            <Line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke={color.line} strokeWidth={1} />
            {weeks.map((x, i) => (
              <Rect key={x.week} x={i * slot + (slot - bar) / 2} y={y(x.load)} width={bar} height={Math.max(0, h - y(x.load))} rx={3} fill={color.wallet} opacity={x.complete ? 1 : 0.45} />
            ))}
            {chronic.includes(" ") ? <Polyline points={chronic} fill="none" stroke={color.text} strokeWidth={1.5} strokeDasharray="4 3" /> : null}
          </Svg>
          <View style={s.axis}>
            <Text style={s.axisText}>{weekLabel(weeks[0].week)}</Text>
            <Text style={s.axisText}>Weekly · dashed: 4-week usual</Text>
          </View>
        </View>
      ) : null}
      {heavy ? (
        <Text style={s.line}>
          Heavier weeks ({heavy.weeks}): HRV <Text style={s.strong}>{ms(heavy.heavy.hrv)}</Text>, other weeks {ms(heavy.other.hrv)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const weekLabel = (monday: string) => new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

// ── Intensity mix ─────────────────────────────────────────────────────────

export function MixCard({ now, zones, rest }: { now: Mix; zones: Record<Zone, Side>; rest: Side }) {
  const days = now.easy + now.moderate + now.hard;
  return (
    <View style={s.card}>
      <Head label="Intensity · last 4 weeks" />
      {days ? <MixBar m={now} height={14} /> : <Text style={type.small}>No trading in the last 4 weeks.</Text>}
      <View style={s.legend}>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <Key key={z} tint={ZONE[z].tint} word={ZONE[z].word} n={now[z]} />
        ))}
        <Key tint={color.faint} word="Rest" n={now.rest} />
      </View>
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, { flex: 1.3, textAlign: "left" }]}>All history</Text>
          <Text style={s.th}>Days</Text>
          <Text style={s.th}>Next day</Text>
          <Text style={s.th}>HRV next morning</Text>
        </View>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <ZoneRow key={z} word={ZONE[z].word} tint={ZONE[z].tint} x={zones[z]} />
        ))}
        <ZoneRow word="Rest" tint={color.faint} x={rest} rest />
      </View>
    </View>
  );
}

function Key({ tint, word, n }: { tint: string; word: string; n: number }) {
  return (
    <View style={s.key}>
      <View style={[s.swatch, { backgroundColor: tint }]} />
      <Text style={s.keyText}>
        {word} <Text style={s.strong}>{n}</Text>
      </Text>
    </View>
  );
}

function MixBar({ m, height }: { m: Mix; height: number }) {
  const parts = (["easy", "moderate", "hard"] as const).filter((z) => m[z] > 0);
  return (
    <View style={[s.mixBar, { height, borderRadius: height / 2 }]}>
      {parts.map((z) => (
        <View key={z} style={{ flex: m[z], backgroundColor: ZONE[z].tint }} />
      ))}
    </View>
  );
}

function ZoneRow({ word, tint, x, rest }: { word: string; tint: string; x: Side; rest?: boolean }) {
  return (
    <View style={s.tr}>
      <View style={{ flex: 1.3, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={[s.swatch, { backgroundColor: tint }]} />
        <Text style={s.td}>{word}</Text>
      </View>
      <Text style={s.tn}>{x.days}</Text>
      <Text style={[s.tn, upDown(x.mean)]}>{rest ? "" : x.mean !== null ? move(x.mean) : "–"}</Text>
      <Text style={s.tn}>{ms(x.hrv)}</Text>
    </View>
  );
}

// ── When you trade best ───────────────────────────────────────────────────

/** Each side of a split as it reads after "Best" or "Worst". */
const PHRASE: Record<Condition, [string, string]> = {
  body: ["steady mornings", "strained mornings"],
  market: ["normal SOL days", "big SOL moves"],
  mood: ["fear days", "greed days"],
  clock: ["days done by midnight", "days past midnight"],
  load: ["after a usual week", "after a heavier week"],
};


export function BestCard({ splits, extremes }: { splits: Split[]; extremes: { best: { split: Split; word: string; s: Side }; worst: { split: Split; word: string; s: Side } } | null }) {
  const phrase = (x: { split: Split; word: string }) => PHRASE[x.split.key][x.word === x.split.a.word ? 0 : 1];
  return (
    <View style={s.card}>
      <Head label="When you trade best" />
      {extremes ? (
        <View style={{ gap: 2 }}>
          <Extreme word="Best" what={phrase(extremes.best)} x={extremes.best.s.mean!} />
          <Extreme word="Worst" what={phrase(extremes.worst)} x={extremes.worst.s.mean!} />
        </View>
      ) : (
        <Text style={type.small}>Needs {MIN_HEADLINE} trades on a side.</Text>
      )}
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, { flex: 0.9, textAlign: "left" }]}>Avg next-day result</Text>
        </View>
        {splits.map((x) => (
          <View key={x.key} style={s.split}>
            <Text style={s.splitLabel}>{x.label}</Text>
            <SideCell word={x.a.word} x={x.a.s} />
            <SideCell word={x.b.word} x={x.b.s} />
          </View>
        ))}
      </View>
    </View>
  );
}

function Extreme({ word, what, x }: { word: string; what: string; x: number }) {
  return (
    <View style={s.extreme}>
      <Text style={s.extremeWord}>{word}</Text>
      <Text style={s.extremeWhat}>{what}</Text>
      <Text style={[s.extremeValue, upDown(x)]}>{move(x)}</Text>
    </View>
  );
}

function SideCell({ word, x }: { word: string; x: Side }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.sideWord} numberOfLines={1}>
        {word}
      </Text>
      <Text style={[s.sideValue, upDown(x.mean)]}>{x.mean !== null ? move(x.mean) : "–"}</Text>
    </View>
  );
}

/** A card's label, and the ⓘ that opens the words it uses. */
function Head({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View style={s.head}>
      <Pressable onPress={() => router.push("/terms" as never)} hitSlop={10} style={s.headLeft}>
        <Text style={type.label}>{label}</Text>
        <Text style={s.info}>ⓘ</Text>
      </Pressable>
      {right}
    </View>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.small}>{label}</Text>
      <Text style={s.figValue}>{value}</Text>
      <Text style={s.figNote}>{note}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  info: { fontSize: 14, color: color.faint },
  state: { fontSize: 15, fontWeight: "700" },
  figs: { flexDirection: "row", gap: space.s },
  figValue: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figNote: { fontSize: 12, color: color.faint },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11, color: color.faint },
  line: { fontSize: 14, lineHeight: 20, color: color.muted },
  strong: { fontWeight: "700", color: color.text },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.l, rowGap: 4 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  keyText: { fontSize: 13.5, color: color.muted },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  mixBar: { flexDirection: "row", overflow: "hidden", gap: 2, backgroundColor: color.raised },
  table: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.s, gap: 2 },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  th: { flex: 1, fontSize: 11.5, color: color.faint, textAlign: "right" },
  td: { fontSize: 14.5, fontWeight: "600", color: color.text },
  tn: { flex: 1, fontSize: 14, fontWeight: "600", color: color.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  extreme: { flexDirection: "row", alignItems: "baseline", gap: space.s },
  extremeWord: { width: 52, fontSize: 13, fontWeight: "600", color: color.muted },
  extremeWhat: { flex: 1, fontSize: 17, fontWeight: "700", color: color.text },
  extremeValue: { fontSize: 17, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
  split: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: space.s },
  splitLabel: { flex: 1.2, fontSize: 13, lineHeight: 17, fontWeight: "600", color: color.muted },
  sideWord: { fontSize: 12, color: color.faint },
  sideValue: { fontSize: 16, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
});
