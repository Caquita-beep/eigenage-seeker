import { router } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Line, Polyline, Rect } from "react-native-svg";
import { DOWN, UP } from "./indicators";
import { TONE_COLOR } from "./insight";
import type { Condition, LoadWeek, Mix, Side, Split, Zone } from "./sport";
import { MIN_HEADLINE } from "./sport";
import { signed } from "./journalread";
import { color, space, type } from "./theme";
import type { TradingWeek } from "./walletread";

/**
 * The sport cards on Insights (`sport.ts`): the trading load, the intensity
 * mix, and the conditions the reader trades best and worst in.
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
      <View style={s.head}>
        <Text style={type.label}>Trading load</Text>
        <Text style={[s.state, { color: word ? TONE_COLOR[word.tone] : color.muted }]}>{word ? word.word : "Learning"} ›</Text>
      </View>
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
            <Text style={s.axisText}>Each bar a week · dashed: the 4 weeks before</Text>
          </View>
        </View>
      ) : null}
      {heavy ? (
        <Text style={s.line}>
          Heavy weeks ({heavy.weeks}): HRV <Text style={s.strong}>{ms(heavy.heavy.hrv)}</Text>, other weeks {ms(heavy.other.hrv)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const weekLabel = (monday: string) => new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

// ── Intensity mix ─────────────────────────────────────────────────────────

export function MixCard({ now, before, zones, rest }: { now: Mix; before: Mix; zones: Record<Zone, Side>; rest: Side }) {
  const days = now.easy + now.moderate + now.hard;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={type.label}>Intensity mix · last 4 weeks</Text>
      </View>
      {days ? (
        <>
          <MixBar m={now} height={14} />
          <View style={s.legend}>
            {(["easy", "moderate", "hard"] as const).map((z) => (
              <View key={z} style={s.legendItem}>
                <View style={[s.swatch, { backgroundColor: ZONE[z].tint }]} />
                <Text style={s.legendText}>
                  {ZONE[z].word} <Text style={s.strong}>{now[z]}</Text>
                </Text>
              </View>
            ))}
            <Text style={s.legendText}>
              Rest <Text style={s.strong}>{now.rest}</Text>
            </Text>
          </View>
          {before.easy + before.moderate + before.hard ? (
            <View style={{ gap: 4 }}>
              <Text style={type.small}>The 8 weeks before</Text>
              <MixBar m={before} height={6} />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={type.small}>No trading in the last 4 weeks.</Text>
      )}

      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, { flex: 1.3, textAlign: "left" }]}>All history</Text>
          <Text style={s.th}>Days</Text>
          <Text style={s.th}>Next day</Text>
          <Text style={s.th}>Realised</Text>
          <Text style={s.th}>HRV night</Text>
        </View>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <ZoneRow key={z} word={ZONE[z].word} tint={ZONE[z].tint} x={zones[z]} />
        ))}
        <ZoneRow word="Rest" tint={color.faint} x={rest} rest />
      </View>
      <Text style={s.foot}>
        Each strain makes a day harder: twice your usual day&apos;s size, on-chain past midnight, or a day SOL moved twice its usual. None is easy, one moderate, two or more hard.
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
      <Text style={[s.tn, Math.abs(x.realised) >= 1 && { color: x.realised > 0 ? UP : DOWN }]}>{rest ? "" : Math.abs(x.realised) >= 1 ? signed(x.realised) : "–"}</Text>
      <Text style={s.tn}>{ms(x.hrv)}</Text>
    </View>
  );
}

// ── When you trade best ───────────────────────────────────────────────────

/** Each side of a split as it reads in a sentence. */
const PHRASE: Record<Condition, [string, string]> = {
  body: ["on Steady mornings", "on Strained mornings"],
  market: ["when SOL moves as usual", "on wild SOL days"],
  mood: ["in fear", "in greed"],
  clock: ["before midnight", "after midnight"],
  load: ["in usual weeks", "coming off a heavy week"],
};

export function BestCard({ splits, extremes }: { splits: Split[]; extremes: { best: { split: Split; word: string; s: Side }; worst: { split: Split; word: string; s: Side } } | null }) {
  const phrase = (x: { split: Split; word: string }) => PHRASE[x.split.key][x.word === x.split.a.word ? 0 : 1];
  return (
    <View style={s.card}>
      <Text style={type.label}>When you trade best</Text>
      {extremes ? (
        <View style={{ gap: 4 }}>
          <Text style={s.headline}>
            Best {phrase(extremes.best)}: <Text style={upDown(extremes.best.s.mean)}>{move(extremes.best.s.mean!)}</Text>
          </Text>
          <Text style={s.headline}>
            Worst {phrase(extremes.worst)}: <Text style={upDown(extremes.worst.s.mean)}>{move(extremes.worst.s.mean!)}</Text>
          </Text>
        </View>
      ) : (
        <Text style={type.small}>Needs {MIN_HEADLINE} scored trades on a side.</Text>
      )}
      <View style={s.table}>
        {splits.map((x) => (
          <View key={x.key} style={s.split}>
            <Text style={s.splitLabel}>{x.label}</Text>
            <View style={s.splitSides}>
              <SideCell word={x.a.word} x={x.a.s} />
              <SideCell word={x.b.word} x={x.b.s} />
            </View>
          </View>
        ))}
      </View>
      <Text style={s.foot}>Each trade scored by its coin&apos;s move over the next day: a buy is right if the coin rose, a sell if it fell.</Text>
    </View>
  );
}

function SideCell({ word, x }: { word: string; x: Side }) {
  return (
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={s.sideWord}>{word}</Text>
      <Text style={[s.sideValue, upDown(x.mean)]}>{x.mean !== null ? move(x.mean) : "–"}</Text>
      <Text style={s.sideNote}>{x.won !== null ? `${pct(x.won)} right · ${x.trades} trades` : `${x.trades} trade${x.trades === 1 ? "" : "s"}`}</Text>
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
  state: { fontSize: 15, fontWeight: "700" },
  figs: { flexDirection: "row", gap: space.s },
  figValue: { fontSize: 20, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  figNote: { fontSize: 12, color: color.faint },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11, color: color.faint },
  line: { fontSize: 14, color: color.muted },
  strong: { fontWeight: "700", color: color.text },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.l },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontSize: 13.5, color: color.muted },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  mixBar: { flexDirection: "row", overflow: "hidden", gap: 2, backgroundColor: color.raised },
  table: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.s, gap: 2 },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  th: { flex: 1, fontSize: 11.5, color: color.faint, textAlign: "right" },
  td: { fontSize: 14.5, fontWeight: "600", color: color.text },
  tn: { flex: 1, fontSize: 14, fontWeight: "600", color: color.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  foot: { fontSize: 12, lineHeight: 17, color: color.faint },
  headline: { fontSize: 17, fontWeight: "700", color: color.text },
  split: { paddingVertical: space.s, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  splitLabel: { fontSize: 12, fontWeight: "600", color: color.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  splitSides: { flexDirection: "row", gap: space.m },
  sideWord: { fontSize: 13.5, color: color.text },
  sideValue: { fontSize: 18, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
  sideNote: { fontSize: 12, color: color.faint, fontVariant: ["tabular-nums"] },
});
