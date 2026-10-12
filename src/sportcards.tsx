import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Line, Path, Polyline, Rect } from "react-native-svg";
import { DOWN, UP } from "./indicators";
import { TONE_COLOR } from "./insight";
import type { Condition, LoadWeek, Mix, Side, Split, Strain, Zone } from "./sport";
import { OUTCOMES, type Drivers, type Outcome } from "./drivers";
import type { MixWindow, Timeline } from "./sportread";
import { oneOf, usePref } from "./prefs";
import { ResToggle } from "./ui";
import { MIN_HEADLINE } from "./sport";
import { color, space, type } from "./theme";
import { usd } from "./pnl";
import type { TradingWeek } from "./walletread";

/**
 * The sport cards (`sport.ts`): the trading load and the intensity mix, on
 * Today; and on Insights the last 90 days, the conditions the reader trades
 * best and worst in, and the correlations. The cards
 * carry numbers and short labels only; every word they group by is defined
 * once, on How Insights are read (`app/terms.tsx`), behind each card's ⓘ.
 * Load, intensity and best start shut to their verdict and numbers; a tap
 * opens the chart or table under them (`FoldMark`), and shuts it again.
 */

const pct = (x: number) => `${Math.round(100 * x)}%`;
const move = (x: number) => (Math.abs(x) < 0.0005 ? "0.0%" : `${x > 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`);
/** Up or down, or no colour for a result that rounds to nothing. */
const upDown = (x: number | null) => (x === null || Math.abs(x) < 0.0005 ? null : { color: x > 0 ? UP : DOWN });
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)} ms`);
/** What a side's sells realised, per day on it: P&L crossed with the same split as everything else. */
const perDay = (x: Side) => (x.days ? x.realised / x.days : null);
const moneyTone = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? null : { color: v > 0 ? UP : DOWN });

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
  const [open, setOpen] = useState(false);
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
    <Pressable onPress={() => setOpen((o) => !o)} style={s.card}>
      <Head
        label="Trading load"
        right={
          <Text style={[s.state, { color: word ? TONE_COLOR[word.tone] : color.muted }]}>
            {word ? word.word : "Learning"} <FoldMark open={open} />
          </Text>
        }
      />
      <View style={s.figs}>
        <Fig label="Last 7 days" value={pct(tw.moved)} note="of wallet moved" />
        <Fig label="Against 4 weeks" value={tw.ratio !== null ? `${tw.ratio.toFixed(1)}×` : "–"} note={tw.usual !== null ? `usual ${pct(tw.usual)}` : "needs 5 weeks"} />
        <Fig label="Rest days" value={rhythm ? `${rhythm.rest} of 7` : "–"} note={rhythm && rhythm.streak > 1 ? `${rhythm.streak} days in a row` : "last 7 nights"} />
      </View>
      {open && weeks.length > 1 ? (
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
      {open && heavy ? (
        <Text style={s.line}>
          Heavier weeks ({heavy.weeks}): HRV <Text style={s.strong}>{ms(heavy.heavy.hrv)}</Text>, other weeks {ms(heavy.other.hrv)}
        </Text>
      ) : null}
      {open ? (
        <Pressable onPress={() => router.push("/chart/load" as never)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
          <Text style={s.toggle}>Full chart ›</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const weekLabel = (monday: string) => new Date(`${monday}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

// ── The last 90 days, aligned ───────────────────────────────────────────

/**
 * The body, the trading and the money on one time axis, as small multiples
 * (each its own scale, never two on one axis): a strip of the morning's
 * assessment, the next morning's HRV against its normal, the wallet moved
 * each day coloured by the day's intensity, and the realised profit summed.
 */
export function TimelineCard({ t }: { t: Timeline }) {
  const w = useInner();
  const n = t.nights.length;
  if (n < 2) return null;
  const x = (i: number) => (i + 0.5) * (w / n);
  const step = w / n;

  // HRV against normal: a line through the nights with a reading, around a dashed zero.
  const H = 64;
  const hMax = Math.max(10, ...t.hrv.map((v) => Math.abs(v ?? 0)));
  const hy = (v: number) => H / 2 - (v / hMax) * (H / 2 - 3);
  let hp = "";
  t.hrv.forEach((v, i) => {
    if (v === null) return;
    hp += `${hp && t.hrv[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${hy(v).toFixed(1)}`;
  });

  // Wallet moved: a bar a trading day, in its intensity's colour.
  const M = 44;
  const mMax = Math.max(0.01, ...t.moved);
  const bar = Math.max(1, step - 1);

  // Realised profit, summed from the window's start.
  const P = 52;
  const pLo = Math.min(0, ...t.pnl);
  const pHi = Math.max(0, ...t.pnl);
  const py = (v: number) => P - 3 - ((v - pLo) / Math.max(1, pHi - pLo)) * (P - 6);
  const pp = t.pnl.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${py(v).toFixed(1)}`).join("");
  const last = t.pnl[n - 1];
  const day = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

  return (
    <View style={s.card}>
      <Head label={`Last ${n} days`} />

      <View style={{ gap: 3 }}>
        <Text style={s.pane}>Assessment that morning</Text>
        <Svg width={w} height={8}>
          {t.tone.map((tone, i) => (tone ? <Rect key={i} x={i * step} y={0} width={Math.max(1, step - 0.5)} height={8} fill={TONE_COLOR[tone]} /> : null))}
        </Svg>
      </View>

      <View style={{ gap: 3 }}>
        <Text style={s.pane}>HRV next morning, against your normal</Text>
        <Svg width={w} height={H}>
          <Line x1={0} x2={w} y1={H / 2} y2={H / 2} stroke={color.line} strokeWidth={1} strokeDasharray="3 3" />
          <Path d={hp} stroke={color.body} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
        </Svg>
      </View>

      <View style={{ gap: 3 }}>
        <Text style={s.pane}>Wallet moved, by intensity</Text>
        <Svg width={w} height={M}>
          <Line x1={0} x2={w} y1={M - 0.5} y2={M - 0.5} stroke={color.line} strokeWidth={1} />
          {t.moved.map((v, i) => {
            const z = t.zone[i];
            if (!z || !(v > 0)) return null;
            const h = Math.max(2, (v / mMax) * (M - 2));
            return <Rect key={i} x={i * step + (step - bar) / 2} y={M - h} width={bar} height={h} rx={Math.min(2, bar / 2)} fill={ZONE[z].tint} />;
          })}
        </Svg>
      </View>

      <View style={{ gap: 3 }}>
        <View style={s.paneHead}>
          <Text style={s.pane}>Realised P&amp;L</Text>
          <Text style={[s.pane, { color: Math.abs(last) < 1 ? color.muted : last > 0 ? UP : DOWN, fontWeight: "700" }]}>{signedUsd(last)}</Text>
        </View>
        <Svg width={w} height={P}>
          <Line x1={0} x2={w} y1={py(0)} y2={py(0)} stroke={color.line} strokeWidth={1} strokeDasharray="3 3" />
          <Path d={pp} stroke={color.text} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
        </Svg>
      </View>

      <View style={s.axis}>
        <Text style={s.axisText}>{day(t.nights[0])}</Text>
        <Text style={s.axisText}>{day(t.nights[n - 1])}</Text>
      </View>
    </View>
  );
}

const signedUsd = (v: number) => `${v < -0.5 ? "−" : v > 0.5 ? "+" : ""}$${Math.round(Math.abs(v)).toLocaleString()}`;

// ── Intensity mix ─────────────────────────────────────────────────────────

const WINDOWS: { key: MixWindow; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "4 weeks" },
  { key: "all", label: "All" },
];

/** The intensity of the trading days: counts over the chosen window, and what each kind of day went on to do (all history). */
export function MixCard({ mixes, zones, rest }: { mixes: Record<MixWindow, Mix>; zones: Record<Zone, Side>; rest: Side }) {
  const [raw, setWindow] = usePref<MixWindow>("today:intensity:window", "week");
  const win = oneOf(raw, ["week", "month", "all"], "week");
  const now = mixes[win];
  const days = now.easy + now.moderate + now.hard;
  // The window to choose, and what each kind of day went on to do: a tap away.
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={s.card}>
      <Head
        label="Intensity"
        right={
          <Text style={s.foldLabel}>
            {WINDOWS.find((x) => x.key === win)!.label} <FoldMark open={open} />
          </Text>
        }
      />
      {days ? <MixBar m={now} height={14} /> : <Text style={type.small}>No trading in this window.</Text>}
      <View style={s.legend}>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <Key key={z} tint={ZONE[z].tint} word={ZONE[z].word} n={now[z]} />
        ))}
        <Key tint={color.faint} word="Rest" n={now.rest} />
      </View>
      {open ? <ResToggle options={WINDOWS} value={win} onChange={setWindow} /> : null}
      {open ? (
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, { flex: 1.3, textAlign: "left" }]}>All history</Text>
          <Text style={s.th}>Days</Text>
          <Text style={s.th}>Next day</Text>
          <Text style={s.th}>P&amp;L a day</Text>
          <Text style={s.th}>HRV next morning</Text>
        </View>
        {(["easy", "moderate", "hard"] as const).map((z) => (
          <ZoneRow key={z} word={ZONE[z].word} tint={ZONE[z].tint} x={zones[z]} />
        ))}
        <ZoneRow word="Rest" tint={color.faint} x={rest} rest />
      </View>
      ) : null}
    </Pressable>
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
      <Text style={[s.tn, moneyTone(perDay(x))]}>{rest ? "" : perDay(x) !== null ? usd(perDay(x)!) : "–"}</Text>
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
  moon: ["after a near-new moon", "after a near-full moon"],
};


export function BestCard({ splits, extremes }: { splits: Split[]; extremes: { best: { split: Split; word: string; s: Side }; worst: { split: Split; word: string; s: Side } } | null }) {
  const phrase = (x: { split: Split; word: string }) => PHRASE[x.split.key][x.word === x.split.a.word ? 0 : 1];
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={s.card}>
      <Head label="When you trade best" right={<FoldMark open={open} />} />
      {extremes ? (
        <View style={{ gap: 2 }}>
          <Extreme word="Best" what={phrase(extremes.best)} x={extremes.best.s.mean!} />
          <Extreme word="Worst" what={phrase(extremes.worst)} x={extremes.worst.s.mean!} />
        </View>
      ) : (
        <Text style={type.small}>
          {splits.some((x) => x.a.s.trades >= MIN_HEADLINE && x.b.s.trades >= MIN_HEADLINE) ? "No clear difference yet." : `Needs ${MIN_HEADLINE} trades on a side.`}
        </Text>
      )}
      {open ? (
        <View style={s.table}>
          <View style={s.tr}>
            <Text style={[s.th, { flex: 0.9, textAlign: "left" }]}>Avg next-day result · P&amp;L a day</Text>
          </View>
          {splits.map((x) => (
            <View key={x.key} style={s.split}>
              <Text style={[s.splitLabel, x.clear && s.corrClear]}>{x.label}</Text>
              <SideCell word={x.a.word} x={x.a.s} />
              <SideCell word={x.b.word} x={x.b.s} />
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Correlations ──────────────────────────────────────────────────────────

const r2 = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}`;
const BAR = 96;

/**
 * One outcome at a time (`drivers.ts`), its drivers strongest first. Each row
 * a bar from zero, over a shaded band of what chance alone gives; only a
 * driver beyond the band is bold.
 */
export function CorrCard({ corr }: { corr: Record<Outcome, Drivers> }) {
  const [raw, setOutcome] = usePref<Outcome>("insights:corr:outcome", "hrv");
  const outcome = oneOf(raw, OUTCOMES.map((o) => o.key), "hrv");
  const { rows, n } = corr[outcome];
  const title = OUTCOMES.find((o) => o.key === outcome)!.title;
  return (
    <View style={s.card}>
      <Head label="Correlations" />
      <ResToggle options={OUTCOMES} value={outcome} onChange={setOutcome} flush />
      <View style={{ gap: 2 }}>
        <Text style={s.corrTitle}>{title}</Text>
        <Text style={s.corrSub}>{n ? `${n} days · strongest first · shaded: chance` : "Not enough days yet."}</Text>
      </View>
      <View>
        {rows.map((x) => (
          <View key={x.label} style={s.corrRow}>
            <Text style={[s.corrLabel, x.clear && s.corrClear]} numberOfLines={2}>
              {x.label}
            </Text>
            <CorrBar r={x.r} band={x.band} clear={x.clear} />
            <Text style={[s.corrValue, x.clear ? s.corrClear : { color: color.faint }]}>{r2(x.r)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A bar from the middle, right for +, left for −, over the band chance alone reaches. */
function CorrBar({ r, band, clear }: { r: number; band: number; clear: boolean }) {
  const half = BAR / 2;
  const len = Math.min(1, Math.abs(r)) * half;
  return (
    <View style={s.corrTrack}>
      <View style={[s.corrBand, { left: half - band * half, width: 2 * band * half }]} />
      <View style={[s.corrZero, { left: half - 0.5 }]} />
      <View style={[s.corrFill, { left: r >= 0 ? half : half - len, width: Math.max(1.5, len), backgroundColor: clear ? color.text : color.faint }]} />
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
      <Text style={[s.sideMoney, moneyTone(perDay(x))]}>{perDay(x) !== null ? usd(perDay(x)!) : "–"}</Text>
    </View>
  );
}

/** At a shut card's right, or an open one's: a tap on the card opens what is under its numbers, or shuts it. */
export function FoldMark({ open }: { open: boolean }) {
  return <Text style={s.fold}>{open ? "▴" : "▾"}</Text>;
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
  corrTitle: { fontSize: 15.5, fontWeight: "700", color: color.text },
  corrSub: { fontSize: 12, color: color.faint },
  corrRow: { flexDirection: "row", alignItems: "center", gap: space.s, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  corrLabel: { flex: 1, fontSize: 14, color: color.muted },
  corrClear: { color: color.text, fontWeight: "700" },
  corrValue: { width: 48, fontSize: 14, textAlign: "right", fontVariant: ["tabular-nums"] },
  corrTrack: { width: BAR, height: 12, justifyContent: "center" },
  corrBand: { position: "absolute", top: 0, bottom: 0, backgroundColor: color.line, borderRadius: 3 },
  corrZero: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: color.line },
  corrFill: { position: "absolute", height: 6, borderRadius: 3 },
  toggle: { fontSize: 13.5, fontWeight: "600", color: color.muted },
  fold: { fontSize: 14, fontWeight: "400", color: color.faint },
  foldLabel: { fontSize: 14, fontWeight: "600", color: color.muted },
  pane: { fontSize: 12, color: color.muted },
  paneHead: { flexDirection: "row", justifyContent: "space-between" },
  sideValue: { fontSize: 16, fontWeight: "700", color: color.muted, fontVariant: ["tabular-nums"] },
  sideMoney: { fontSize: 12.5, fontWeight: "600", color: color.faint, fontVariant: ["tabular-nums"] },
});
