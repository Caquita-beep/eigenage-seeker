import { router } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Line, Polyline, Rect } from "react-native-svg";
import { DOWN, UP } from "./indicators";
import { TONE_COLOR } from "./insight";
import type { Condition, IntensityRead, LoadWeek, Mix, Side, Split, Strain, Zone } from "./sport";
import { MIN_HEADLINE } from "./sport";
import { signed } from "./journalread";
import { color, space, type } from "./theme";
import type { TradingWeek } from "./walletread";

/**
 * The sport cards on Insights (`sport.ts`): the trading load, the intensity
 * mix, and the conditions the reader trades best and worst in. Every word a
 * card uses for a group is defined on the card that uses it, in the same
 * terms as the rest of the app: the body's states are the assessment's, and
 * "steady" and "strained" are the journal's grouping of them.
 */

const pct = (x: number) => `${Math.round(100 * x)}%`;
const move = (x: number) => (Math.abs(x) < 0.0005 ? "0.0%" : `${x > 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`);
/** Up or down, or no colour for a result that rounds to nothing. */
const upDown = (x: number | null) => (x === null || Math.abs(x) < 0.0005 ? null : { color: x > 0 ? UP : DOWN });
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)} ms`);

export const ZONE: Record<Zone, { word: string; tint: string; means: string }> = {
  easy: { word: "Easy", tint: TONE_COLOR.good, means: "None of the three strains" },
  moderate: { word: "Moderate", tint: TONE_COLOR.watch, means: "One strain" },
  hard: { word: "Hard", tint: TONE_COLOR.bad, means: "Two or three strains" },
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
          Heavier weeks ({heavy.weeks}): HRV <Text style={s.strong}>{ms(heavy.heavy.hrv)}</Text>, other weeks {ms(heavy.other.hrv)}
        </Text>
      ) : null}
      <Text style={s.foot}>Load: the share of your wallet (SOL and stablecoins) you swapped. Heavier: 1.5× the 4 weeks before or more; lighter: two thirds or less.</Text>
    </Pressable>
  );
}

const weekLabel = (monday: string) => new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

// ── Intensity mix ─────────────────────────────────────────────────────────

export function MixCard({ now, before, zones, rest, read }: { now: Mix; before: Mix; zones: Record<Zone, Side>; rest: Side; read: IntensityRead }) {
  const days = now.easy + now.moderate + now.hard;
  const recent = read.recent;
  return (
    <View style={s.card}>
      <Text style={type.label}>Intensity mix</Text>

      <View style={{ gap: 6 }}>
        <Text style={[s.headline, read.costly && { color: TONE_COLOR.watch }]}>{read.verdict}</Text>
        {recent && recent.zone !== "easy" ? (
          <Text style={s.line}>
            Your last trading day was <Text style={{ color: ZONE[recent.zone].tint, fontWeight: "700" }}>{ZONE[recent.zone].word}</Text> ({strainList(recent.strains).toLowerCase()}).{" "}
            <Text style={s.strong}>Keep today easy, or rest.</Text>
          </Text>
        ) : null}
        <Text style={s.line}>To keep a day easy: trade your usual size, stop by midnight, and sit out big SOL moves.</Text>
      </View>

      <View style={s.defs}>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <View key={z} style={s.def}>
            <View style={[s.swatch, { backgroundColor: ZONE[z].tint }]} />
            <Text style={s.defWord}>{ZONE[z].word}</Text>
            <Text style={s.defMeans}>{ZONE[z].means}</Text>
          </View>
        ))}
        <View style={s.def}>
          <View style={[s.swatch, { backgroundColor: color.faint }]} />
          <Text style={s.defWord}>Rest</Text>
          <Text style={s.defMeans}>No trades</Text>
        </View>
        <Text style={s.foot}>
          The strains: <Text style={s.footStrong}>big size</Text>, twice your usual trading day (the median of the last 90 days); <Text style={s.footStrong}>late</Text>, on-chain between midnight and 5 am; and a <Text style={s.footStrong}>big SOL move</Text>, SOL moving twice its usual amount that day.
        </Text>
      </View>

      <View style={{ gap: space.s }}>
        <Text style={type.small}>Last 4 weeks</Text>
        {days ? (
          <>
            <MixBar m={now} height={14} />
            <View style={s.legend}>
              {(["easy", "moderate", "hard"] as const).map((z) => (
                <Text key={z} style={s.legendText}>
                  {ZONE[z].word} <Text style={s.strong}>{now[z]}</Text>
                </Text>
              ))}
              <Text style={s.legendText}>
                Rest <Text style={s.strong}>{now.rest}</Text>
              </Text>
            </View>
          </>
        ) : (
          <Text style={type.small}>No trading in the last 4 weeks.</Text>
        )}
        {before.easy + before.moderate + before.hard ? (
          <View style={{ gap: 4 }}>
            <Text style={type.small}>The 8 weeks before</Text>
            <MixBar m={before} height={6} />
          </View>
        ) : null}
      </View>

      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, { flex: 1.25, textAlign: "left" }]}>All your history</Text>
          <Text style={[s.th, { flex: 0.6 }]}>Days</Text>
          <Text style={s.th}>Next-day result</Text>
          <Text style={s.th}>Realised</Text>
          <Text style={s.th}>HRV that night</Text>
        </View>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <ZoneRow key={z} word={ZONE[z].word} tint={ZONE[z].tint} x={zones[z]} />
        ))}
        <ZoneRow word="Rest" tint={color.faint} x={rest} rest />
      </View>
      <Text style={s.foot}>
        <Text style={s.footStrong}>Next-day result</Text>: how a trade&apos;s coin moved in the 24 hours after it, in your favour (+) or against you (−), averaged over the trades. <Text style={s.footStrong}>Realised</Text>: profit or loss your sells locked in those days.
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
      <View style={{ flex: 1.25, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={[s.swatch, { backgroundColor: tint }]} />
        <Text style={s.td}>{word}</Text>
      </View>
      <Text style={[s.tn, { flex: 0.6 }]}>{x.days}</Text>
      <Text style={[s.tn, upDown(x.mean)]}>{rest ? "" : x.mean !== null ? move(x.mean) : "–"}</Text>
      <Text style={[s.tn, Math.abs(x.realised) >= 1 && { color: x.realised > 0 ? UP : DOWN }]}>{rest ? "" : Math.abs(x.realised) >= 1 ? signed(x.realised) : "–"}</Text>
      <Text style={s.tn}>{ms(x.hrv)}</Text>
    </View>
  );
}

// ── When you trade best ───────────────────────────────────────────────────

/** Each side of a split as it reads in a sentence. */
const PHRASE: Record<Condition, [string, string]> = {
  body: ["on steady mornings", "on strained mornings"],
  market: ["on normal SOL days", "on days of a big SOL move"],
  mood: ["in fear", "in greed"],
  clock: ["before midnight", "after midnight"],
  load: ["in usual weeks", "after a heavier week"],
};

/** What each split's two words mean, in the app's own terms. */
const DEFINE: Record<Condition, string> = {
  body: "Steady: the assessment that morning was Coping well or Stable. Strained: Acute stress, Maladaptation or Accumulated fatigue.",
  market: "Big SOL move: SOL moved twice its usual amount that day.",
  mood: "The Fear & Greed index that day: fear under 45, greed over 55.",
  clock: "After midnight: on-chain between midnight and 5 am.",
  load: "Heavier: the 7 days before moved 1.5× the 4 weeks before them, or more.",
};

export function BestCard({ splits, extremes }: { splits: Split[]; extremes: { best: { split: Split; word: string; s: Side }; worst: { split: Split; word: string; s: Side } } | null }) {
  const phrase = (x: { split: Split; word: string }) => PHRASE[x.split.key][x.word === x.split.a.word ? 0 : 1];
  return (
    <View style={s.card}>
      <Text style={type.label}>When you trade best</Text>
      {extremes ? (
        <View style={{ gap: 4 }}>
          <Text style={s.headline}>
            Best {phrase(extremes.best)}: <Text style={upDown(extremes.best.s.mean)}>{move(extremes.best.s.mean!)}</Text> a trade
          </Text>
          <Text style={s.headline}>
            Worst {phrase(extremes.worst)}: <Text style={upDown(extremes.worst.s.mean)}>{move(extremes.worst.s.mean!)}</Text> a trade
          </Text>
        </View>
      ) : (
        <Text style={type.small}>Needs {MIN_HEADLINE} trades on a side to name the best and the worst.</Text>
      )}
      <Text style={s.foot}>
        Each figure is the <Text style={s.footStrong}>next-day result</Text>: how a trade&apos;s coin moved in the 24 hours after it, in your favour (+) or against you (−), averaged over the trades. A buy goes your way if the coin rises, a sell if it falls.
      </Text>
      <View style={s.table}>
        {splits.map((x) => (
          <View key={x.key} style={s.split}>
            <Text style={s.splitLabel}>{x.label}</Text>
            <Text style={s.splitDef}>{DEFINE[x.key]}</Text>
            <View style={s.splitSides}>
              <SideCell word={x.a.word} x={x.a.s} />
              <SideCell word={x.b.word} x={x.b.s} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function SideCell({ word, x }: { word: string; x: Side }) {
  return (
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={s.sideWord}>{word}</Text>
      <Text style={[s.sideValue, upDown(x.mean)]}>{x.mean !== null ? move(x.mean) : "–"}</Text>
      <Text style={s.sideNote}>{x.won !== null ? `${pct(x.won)} went your way · ${x.trades} trades` : `${x.trades} trade${x.trades === 1 ? "" : "s"}, too few`}</Text>
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
  line: { fontSize: 14, lineHeight: 20, color: color.muted },
  strong: { fontWeight: "700", color: color.text },
  defs: { gap: 6, paddingTop: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  def: { flexDirection: "row", alignItems: "center", gap: space.s },
  defWord: { width: 76, fontSize: 14, fontWeight: "700", color: color.text },
  defMeans: { flex: 1, fontSize: 13.5, color: color.muted },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.l },
  legendText: { fontSize: 13.5, color: color.muted },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  mixBar: { flexDirection: "row", overflow: "hidden", gap: 2, backgroundColor: color.raised },
  table: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingTop: space.s, gap: 2 },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  th: { flex: 1, fontSize: 11.5, color: color.faint, textAlign: "right" },
  td: { fontSize: 14.5, fontWeight: "600", color: color.text },
  tn: { flex: 1, fontSize: 14, fontWeight: "600", color: color.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  foot: { fontSize: 12, lineHeight: 17, color: color.faint },
  footStrong: { fontWeight: "700", color: color.muted },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: "700", color: color.text },
  split: { paddingVertical: space.s, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  splitLabel: { fontSize: 12, fontWeight: "600", color: color.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  splitDef: { fontSize: 12, lineHeight: 17, color: color.faint },
  splitSides: { flexDirection: "row", gap: space.m, paddingTop: 2 },
  sideWord: { fontSize: 13.5, color: color.text },
  sideValue: { fontSize: 18, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
  sideNote: { fontSize: 12, color: color.faint, fontVariant: ["tabular-nums"] },
});
