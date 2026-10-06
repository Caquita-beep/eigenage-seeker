import { Stack } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { BodyNights } from "../body";
import { metricName, readBody, sourceName, STATE, type Banded, type BodyRead } from "../bodyview";
import { dayMs } from "../candles";
import { addDays } from "../engine/nights";
import { useBody, useMarket, useWalletData } from "../data";
import { align, type Line, type Values } from "../indicators";
import { bandPill } from "../labels";
import type { MarketView } from "../market";
import { oneOf, toggled, usePref } from "../prefs";
import { ProChart, Tabs, type Pane } from "../prochart";
import { MONTH_PRESETS, toMonthly, toWeekly, WEEK_PRESETS } from "../resample";
import { color, space, type } from "../theme";
import { Pill, ResToggle } from "../ui";
import type { WalletView } from "../wallet";

/**
 * The body's charts. Each shows the nightly value, its 7-night mean and the
 * 60-night band — the same instrument as everywhere else in the app — and
 * lets the market and the wallet be laid underneath on the same nights, which
 * is the whole idea: see the body and what it lived through on one axis.
 */

export type BodyId = "hrv" | "hrvcv" | "rhr" | "sleep" | "energy";

/** WHOOP gives one HRV a day, so the windows go down to a week of daily values. */
const PRESETS = [
  { label: "1W", count: 7 },
  { label: "2W", count: 14 },
  { label: "1M", count: 30 },
  { label: "3M", count: 91 },
  { label: "6M", count: 182 },
  { label: "1Y", count: 365 },
  { label: "All", count: 100_000 },
];

const BODY = color.body;
const MEAN = "#EDEEF0";

function bandedPane(key: string, b: Banded, format: (v: number) => string, kind: Line["kind"] = "dots", label = "Day"): Pane {
  return {
    key,
    height: 230,
    lines: [
      { key: "night", label, values: b.series.map((p) => p.value), color: BODY, kind, width: 1 },
      { key: "mean", label: "7-day avg", values: b.series.map((p) => p.mean), color: MEAN, width: 1.6 },
    ],
    bands: [{ key: "band", low: b.series.map((p) => p.low), high: b.series.map((p) => p.high), color: BODY, opacity: 0.14 }],
    format,
  };
}

interface Built {
  title: string;
  days: string[];
  main: Pane;
  head: ReactNode;
  about: ReactNode;
}

function build(id: BodyId, body: BodyNights, r: BodyRead): Built {
  const ms = (v: number) => `${v.toFixed(0)}`;
  if (id === "hrv") {
    const now = r.hrv.now;
    return {
      title: metricName(body),
      days: r.hrv.series.map((p) => p.night),
      main: bandedPane("hrv", r.hrv, ms),
      head: <Head value={now ? `${now.value.toFixed(0)} ms` : "–"} sub={now ? `7-day average · your normal ${now.low.toFixed(0)}–${now.high.toFixed(0)} ms` : "Not enough days yet"} pill={now ? bandPill[now.position] : undefined} />,
      about: (
        <>
          <P>
            Dots are each day's HRV, measured during sleep; the white line is the 7-day average; the band is your own normal, the last 60 days'
            mean plus and minus one standard deviation of the nights in it. One low day is mostly noise. An average that leaves the band is not.
          </P>
          {body.metric === "sdnn" ? (
            <P>
              Apple Watch measures HRV as SDNN over about a minute, several times a night; the value here is the mean of the readings between
              midnight and 10:00. The method is written for rMSSD. It is applied to SDNN the same way, against itself, so the state is
              yours but the numbers are not comparable with anyone's rMSSD.
            </P>
          ) : null}
          {body.source === "whoop-synthetic" ? (
            <P>
              Synthetic: these days were generated, not measured. They are WHOOP-shaped records read through the same code a real WHOOP
              account will be, with an illness, a heavy block and a week of travel planted so each state appears.
            </P>
          ) : null}
        </>
      ),
    };
  }
  if (id === "hrvcv") {
    const nights = [...r.readings.keys()].sort();
    const vals = nights.map((n) => r.readings.get(n)!);
    const latest = r.latest;
    return {
      title: "CV · day-to-day variation",
      days: nights,
      main: {
        key: "cv",
        height: 230,
        lines: [{ key: "cv", label: "CV", values: vals.map((v) => v.cv), color: BODY, width: 1.6 }],
        format: (v) => `${v.toFixed(1)}%`,
      },
      head: latest ? (
        <Head value={`${latest.cv.toFixed(1)}%`} sub={`CV of the last 7 days · ${STATE[latest.state].word}`} pill={bandPill[latest.cvPosition]} />
      ) : (
        <Head value="–" sub="Not enough days yet" />
      ),
      about: (
        <P>
          How much the last 7 days varied, as a share of their mean. Plews and colleagues found it tracked adaptation in elite triathletes where
          the mean did not. It is read with the baseline, never alone: a quiet week over a normal baseline is stability, and over a suppressed one
          it is a system that has stopped responding.
        </P>
      ),
    };
  }
  if (id === "rhr") {
    const now = r.rhr.now;
    return {
      title: "Resting heart rate",
      days: r.rhr.series.map((p) => p.night),
      main: bandedPane("rhr", r.rhr, ms),
      head: <Head value={now ? `${now.value.toFixed(0)} bpm` : "–"} sub={now ? `7-day average · your normal ${now.low.toFixed(0)}–${now.high.toFixed(0)}` : "Not enough days yet"} pill={now ? bandPill[now.position] : undefined} />,
      about: <P>Filed under the night before its day, so it lines up with the market and the trading that came before it.</P>,
    };
  }
  if (id === "sleep") {
    const now = r.sleep.now;
    return {
      title: "Sleep",
      days: r.sleep.series.map((p) => p.night),
      main: bandedPane("sleep", r.sleep, (v) => `${v.toFixed(1)}h`, "bars", "Asleep"),
      head: <Head value={now ? `${now.value.toFixed(1)} h` : "–"} sub={now ? `7-day average · your normal ${now.low.toFixed(1)}–${now.high.toFixed(1)} h` : "Not enough days yet"} pill={now ? bandPill[now.position] : undefined} />,
      about: (
        <P>
          Hours asleep: the asleep stages only, joined so that two sources recording the same sleep are counted once. Sleep sits on the path from
          a late night to a low morning, so Exposure does not hold it fixed; doing so would remove the very effect being asked about.
        </P>
      ),
    };
  }
  const now = r.energy.now;
  return {
    title: "Activity",
    days: r.energy.series.map((p) => p.night),
    main: bandedPane("energy", r.energy, (v) => v.toFixed(0), "bars", "Active kcal"),
    head: <Head value={now ? `${now.value.toFixed(0)} kcal` : "–"} sub="Active energy, 7-day mean" pill={now ? bandPill[now.position] : undefined} />,
    about: (
      <P>
        The day's physical load. Exposure holds it fixed wherever the body is the outcome, so a hard training day is not mistaken for a hard day in
        the market. It stands in for Whoop's strain, which Apple Watch does not measure.
      </P>
    ),
  };
}

/** The body's charts as price-chart indicators (`details/price.tsx`), with their tab labels. */
export const BODY_INDICATORS: { id: BodyId; label: string; has: (b: BodyNights) => boolean }[] = [
  { id: "hrv", label: "HRV", has: (b) => b.hrv.length > 0 },
  { id: "hrvcv", label: "CV", has: (b) => b.hrv.length > 0 },
  { id: "rhr", label: "RHR", has: (b) => b.rhr.length > 0 },
  { id: "sleep", label: "Sleep", has: (b) => b.sleep.length > 0 },
  { id: "energy", label: "Activity", has: (b) => b.energy.length > 0 },
];

const INDICATOR: Record<BodyId, { title: (b: BodyNights) => string; series: (r: BodyRead) => Banded; day: string; format: (v: number) => string }> = {
  hrv: { title: metricName, series: (r) => r.hrv, day: "Day", format: (v) => v.toFixed(0) },
  hrvcv: { title: () => "CV of HRV", series: (r) => r.cv, day: "CV", format: (v) => `${v.toFixed(1)}%` },
  rhr: { title: () => "Resting heart rate", series: (r) => r.rhr, day: "Day", format: (v) => v.toFixed(0) },
  sleep: { title: () => "Sleep", series: (r) => r.sleep, day: "Asleep", format: (v) => `${v.toFixed(1)}h` },
  energy: { title: () => "Activity", series: (r) => r.energy, day: "Active kcal", format: (v) => v.toFixed(0) },
};

/**
 * A body signal as the assessment reads it, laid on another chart's days: each
 * day joined into a curve, the 7-day average the status is read from (white),
 * and the normal range it is read against, with that range's 60-day average
 * dashed through it. The CV is already a 7-day figure, so it is the white line
 * itself. Night D sits under day D, as the market sits under the body here.
 */
export function bodyPaneOn(id: BodyId, body: BodyNights, r: BodyRead, days: string[], height: number): Pane {
  const ind = INDICATOR[id];
  const at = new Map(ind.series(r).series.map((p) => [p.night, p]));
  const col = (f: (p: Banded["series"][number]) => number | null): Values => days.map((d) => (at.has(d) ? f(at.get(d)!) : null));
  const lines: Line[] = [
    ...(id === "hrvcv" ? [] : [{ key: "night", label: ind.day, values: col((p) => p.value), color: BODY, width: 1, bridge: true }]),
    { key: "mean", label: id === "hrvcv" ? "CV" : "7-day avg", values: col((p) => (id === "hrvcv" ? p.value : p.mean)), color: MEAN, width: 1.8 },
    { key: "normal", label: "60-day avg", values: col((p) => p.normal), color: color.muted, width: 1, dashed: true },
  ];
  return {
    key: `body:${id}`,
    title: ind.title(body),
    height,
    lines,
    bands: [{ key: "band", low: col((p) => p.low), high: col((p) => p.high), color: BODY, opacity: 0.14 }],
    format: ind.format,
  };
}

/**
 * The same pane by week, for a weekly price chart: every line and the band
 * averaged over each week's nights (`toWeekly`), on the weeks given (their
 * Mondays). A week's average of the nights already is the average the status
 * reads, so it is the white line, and the 7-day line is left out.
 */
export function bodyPaneOnWeeks(id: BodyId, body: BodyNights, r: BodyRead, weeks: string[], height: number): Pane {
  const nights: string[] = [];
  if (weeks.length) for (let d = weeks[0]; d <= addDays(weeks[weeks.length - 1], 6); d = addDays(d, 1)) nights.push(d);
  const w = toWeekly(nights, [bodyPaneOn(id, body, r, nights, height)]);
  const at = new Map(w.days.map((d, i) => [d, i]));
  const pick = (xs: Values): Values => weeks.map((wk) => (at.has(wk) ? xs[at.get(wk)!] : null));
  const p = w.panes[0];
  const week = p.lines.find((l) => l.key === "night") ?? p.lines.find((l) => l.key === "mean")!;
  const normal = p.lines.find((l) => l.key === "normal")!;
  return {
    ...p,
    lines: [
      { ...week, key: "week", label: id === "hrvcv" ? "CV, week avg" : "Week avg", values: pick(week.values), color: MEAN, width: 1.8, bridge: true },
      { ...normal, values: pick(normal.values) },
    ],
    bands: p.bands?.map((b) => ({ ...b, low: pick(b.low), high: pick(b.high) })),
  };
}

/** Market and wallet series laid on the body's nights. */
function overlays(days: string[], market: MarketView | null, wallet: WalletView | null, on: Set<string>): Pane[] {
  const out: Pane[] = [];
  const m = <T,>(pts: [string, T][]) => new Map(pts);
  if (on.has("dvol") && market) {
    out.push({
      key: "dvol",
      title: "DVOL",
      height: 80,
      lines: [{ key: "dvol", label: "Fear, priced", values: align(days, m(market.dvolSeries.map((d) => [d.day, d.value]))), color: color.market }],
      format: (v) => v.toFixed(0),
    });
  }
  if (on.has("fng") && market) {
    out.push({
      key: "fng",
      title: "Fear & Greed",
      height: 70,
      lines: [{ key: "fng", label: "Index", values: align(days, m(market.fngSeries)), color: color.muted }],
      domain: [0, 100],
      guides: [25, 75],
      format: (v) => v.toFixed(0),
    });
  }
  if (on.has("sol") && market) {
    out.push({
      key: "sol",
      title: "SOL",
      height: 70,
      lines: [{ key: "sol", label: "SOL/USDT", values: align(days, m(market.solBars.map((b) => [b.day, b.close]))), color: "#56B6C2" }],
      format: (v) => v.toFixed(0),
    });
  }
  if (on.has("load") && wallet) {
    const v: Values = align(days, m(wallet.load.map((p) => [p.night, p.value])));
    out.push({
      key: "load",
      title: "Trading load",
      height: 70,
      lines: [{ key: "load", label: "Share swapped", values: v, color: color.wallet, kind: "bars" }],
      format: (x) => `${(x * 100).toFixed(0)}%`,
    });
  }
  return out;
}

export function BodyDetail({ id }: { id: BodyId }) {
  const { body } = useBody();
  const { view: market } = useMarket();
  const { view: wallet } = useWalletData();
  // Layers, resolution and window are remembered per chart (`prefs.ts`).
  const [onList, setOn] = usePref<string[]>(`${id}:layers`, id === "hrv" ? ["dvol"] : []);
  const on = useMemo(() => new Set(onList), [onList]);
  const [touching, setTouching] = useState(false);
  const read = useMemo(() => (body ? readBody(body) : null), [body]);
  const b = useMemo(() => (body && read ? build(id, body, read) : null), [id, body, read]);
  const t = useMemo(() => b?.days.map(dayMs) ?? [], [b?.days]);
  const subs = useMemo(() => (b ? overlays(b.days, market, wallet, on) : []), [b, market, wallet, on]);
  // Daily or weekly. No intraday: WHOOP measures HRV and resting heart rate once a day, during sleep.
  const [resRaw, setRes] = usePref<"d" | "w" | "m">(`${id}:res`, "d");
  const res = oneOf(resRaw, ["d", "w", "m"], "d");
  const shown = useMemo(() => {
    if (!b) return null;
    if (res === "d") return { t, main: b.main, subs };
    const w = (res === "w" ? toWeekly : toMonthly)(b.days, [b.main, ...subs]);
    return { t: w.days.map(dayMs), main: w.panes[0], subs: w.panes.slice(1) };
  }, [b, t, subs, res]);

  if (!body || !b || !shown) return <Stack.Screen options={{ title: "" }} />;
  const toggles = [
    { key: "dvol", label: "DVOL" },
    { key: "fng", label: "Fear & Greed" },
    { key: "sol", label: "SOL" },
    ...(wallet ? [{ key: "load", label: "Trading load" }] : []),
  ];
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: b.title }} />
      <View style={s.pad}>{b.head}</View>
      <ResToggle
        options={[
          { key: "d", label: "Daily" },
          { key: "w", label: "Weekly" },
          { key: "m", label: "Monthly" },
        ]}
        value={res}
        onChange={setRes}
      />
      <View style={s.chart}>
        <ProChart
          key={res}
          t={shown.t}
          main={shown.main}
          subs={shown.subs}
          time={res === "d" ? "daily" : "weekly"}
          initialCount={res === "d" ? 30 : res === "w" ? 26 : 12}
          presets={res === "d" ? PRESETS : res === "w" ? WEEK_PRESETS : MONTH_PRESETS}
          persist={`${id}:${res}`}
          onInteraction={setTouching}
        />
      </View>
      <View style={s.tabs}>
        <Text style={[type.label, { paddingHorizontal: space.s, paddingTop: space.xs }]}>Lay underneath</Text>
        <Tabs
          items={toggles}
          on={(k) => on.has(k)}
          onPress={(k) => setOn((prev) => toggled(prev, k))}
        />
      </View>
      <View style={[s.pad, { gap: space.m }]}>
        {b.about}
        <Text style={[type.small, { color: color.faint }]}>
          From {sourceName(body)}, imported {new Date(body.importedAt).toLocaleDateString()}. Read on this phone and kept on it. Nights are named
          after their evening, so a morning's reading sits under the market day before it.
        </Text>
      </View>
    </ScrollView>
  );
}

function Head({ value, sub, pill }: { value: string; sub: string; pill?: { text: string; tint: string } }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <Text style={s.value}>{value}</Text>
        {pill ? <Pill {...pill} /> : null}
      </View>
      <Text style={type.small}>{sub}</Text>
    </View>
  );
}

const P = ({ children }: { children: ReactNode }) => <Text style={[type.small, { color: color.muted }]}>{children}</Text>;

const s = StyleSheet.create({
  content: { paddingBottom: space.xxl, gap: space.m },
  pad: { paddingHorizontal: space.l },
  value: { fontSize: 30, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  tabs: { paddingHorizontal: space.s },
});
