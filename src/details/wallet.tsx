import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { dayMs } from "../candles";
import { useWalletData } from "../data";
import { bandPill } from "../labels";
import { oneOf, toggled, usePref } from "../prefs";
import { ProChart, Tabs, type Pane } from "../prochart";
import { HOUR_PRESETS, toWeekly, WEEK_PRESETS } from "../resample";
import { color, space, type } from "../theme";
import { fmt, NightClock, Pill, ResToggle, Row, Stat } from "../ui";
import type { WalletView } from "../wallet";
import type { HourBucket } from "../walletview";

const PRESETS = [
  { label: "1M", count: 30 },
  { label: "3M", count: 91 },
  { label: "All", count: 100_000 },
];

/** Counts are whole: label whole-number ticks and leave the fractional ones blank, rather than rounding 0.75 to "1". */
const count = (x: number) => (Math.abs(x - Math.round(x)) < 1e-6 ? x.toFixed(0) : "");
/** A count axis from zero to a multiple of four, so the chart's quarter ticks all land on whole numbers. */
const countDomain = (values: (number | null)[]): [number, number] => {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null && Number.isFinite(v)));
  return [0, Math.max(4, 4 * Math.ceil(max / 4))];
};

const SUB = [
  { key: "swaps", label: "Swaps", color: "#E5C07B", format: count },
  { key: "usd", label: "Dollars swapped", color: "#98C379", format: (x: number) => fmt.usd(x) },
  { key: "late", label: "After 22:00", color: "#C678DD", format: count },
  { key: "count", label: "All signed", color: color.muted, format: count },
] as const;
type SubKey = (typeof SUB)[number]["key"];

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function subPane(v: WalletView, k: SubKey): Pane {
  const d = SUB.find((x) => x.key === k)!;
  const values = v.load.map((p) => p[k]);
  return {
    key: k,
    title: d.label,
    height: 80,
    lines: [{ key: k, label: d.label, values, color: d.color, kind: "bars" }],
    domain: d.format === count ? countDomain(values) : undefined,
    format: d.format,
  };
}

export function LoadDetail({ initialSub }: { initialSub?: string }) {
  const { view: v } = useWalletData();
  // The panes chosen here are remembered (`prefs.ts`); the row tapped to get here is always among them.
  const [subsRaw, setSubs] = usePref<SubKey[]>("load:subs", []);
  const subs = useMemo(() => subsRaw.filter((k) => SUB.some((x) => x.key === k)), [subsRaw]);
  useEffect(() => {
    const k = SUB.find((x) => x.key === initialSub)?.key;
    if (k) setSubs((prev) => (prev.includes(k) ? prev : [...prev, k]));
  }, [initialSub]);
  const [touching, setTouching] = useState(false);
  const t = useMemo(() => v?.load.map((p) => dayMs(p.night)) ?? [], [v]);
  const main = useMemo<Pane | null>(
    () =>
      v
        ? {
            key: "main",
            height: 220,
            lines: [{ key: "load", label: "Load", values: v.load.map((p) => p.value), color: color.wallet, kind: "bars" }],
            bands: [{ key: "normal", low: v.load.map((p) => (p.low === null ? null : Math.max(0, p.low))), high: v.load.map((p) => p.high), color: color.wallet }],
            format: pct,
          }
        : null,
    [v],
  );
  const subPanes = useMemo(() => (v ? subs.map((k) => subPane(v, k)) : []), [v, subs]);

  if (!v || !main) return <Stack.Screen options={{ title: "Trading load" }} />;
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Trading load" }} />
      <View style={s.pad}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
          <Text style={s.value}>{v.loadNow ? pct(v.loadNow.baseline) : "–"}</Text>
          {v.loadNow ? <Pill {...bandPill[v.loadNow.position]} /> : null}
        </View>
        <Text style={type.small}>
          {v.loadNow
            ? `Share of liquid holdings swapped a night, last 7 nights. Your 60-night normal: ${pct(Math.max(0, v.loadNow.low))}–${pct(v.loadNow.high)}.`
            : "Not enough nights with trades yet to set a normal."}
        </Text>
      </View>
      <View style={s.chart}>
        <Resolved
          t={t}
          days={v.load.map((p) => p.night)}
          main={main}
          subs={subPanes}
          hourly={v.hours ? hourlyLoad(v.hours, subs) : null}
          persist="load"
          onInteraction={setTouching}
        />
      </View>
      <View style={s.tabs}>
        <Tabs
          items={SUB.map((x) => ({ key: x.key, label: x.label }))}
          on={(k) => subs.includes(k)}
          onPress={(k) => setSubs((prev) => toggled(prev, k))}
        />
      </View>
      <View style={[s.pad, { gap: space.m }]}>
        <Row>
          <Stat label="Swaps, 30 nights" value={`${v.last30.swaps}`} />
          <Stat label="Swapped" value={fmt.usd(v.last30.usd)} />
          <Stat label="Failed" value={`${v.last30.failed}`} tint={v.last30.failed ? color.below : undefined} />
        </Row>
        <Text style={[type.small, { color: color.muted }]}>
          Each bar is one night, 18:00 to 05:00: the share of your SOL and stablecoins that swaps moved. Size is measured against what you held,
          so a $50 swap from a $100 wallet weighs more than $5,000 from a million. The band is your own 60-night normal.
        </Text>
        <Text style={[type.small, { color: color.faint }]}>
          Read from your wallet's signed transactions on Solana mainnet, by this phone. SOL is priced at Binance's daily close; USDC and USDT at
          a dollar.
        </Text>
      </View>
    </ScrollView>
  );
}

export function NightsDetail() {
  const { view: v } = useWalletData();
  const [touching, setTouching] = useState(false);
  const t = useMemo(() => v?.load.map((p) => dayMs(p.night)) ?? [], [v]);
  const panes = useMemo(() => {
    if (!v) return null;
    const main: Pane = {
      key: "main",
      height: 170,
      lines: [{ key: "late", label: "After 22:00", values: v.load.map((p) => p.late), color: "#C678DD", kind: "bars" }],
      domain: countDomain(v.load.map((p) => p.late)),
      format: count,
    };
    const awake: Pane = {
      key: "awake",
      title: "Awake",
      height: 50,
      lines: [{ key: "awake", label: "After midnight", values: v.load.map((p) => p.awake), color: color.wallet, kind: "bars" }],
      domain: [0, 1],
      format: (x) => (x >= 0.5 ? "yes" : "no"),
    };
    return { main, subs: [awake] };
  }, [v]);

  if (!v || !panes) return <Stack.Screen options={{ title: "Your nights" }} />;
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Your nights" }} />
      <View style={[s.pad, s.clockRow]}>
        <NightClock minutes={v.clock} size={190} />
        <View style={{ flex: 1, gap: space.m }}>
          <Stat label="Awake after midnight" value={`${v.last30.awakeNights}`} note="of the last 30 nights" />
          <Stat label="Signed after 22:00" value={`${v.last30.lateActs}`} note="last 30 nights" />
        </View>
      </View>
      <Text style={[type.small, s.pad, { color: color.muted }]}>
        The night as a clock, 18:00 at the top round to 05:00. Each tick is a transaction you signed in the last 30 nights; the shaded part is
        midnight to five, where being awake is the exposure.
      </Text>
      <View style={s.chart}>
        <Resolved
          t={t}
          days={v.load.map((p) => p.night)}
          main={panes.main}
          subs={panes.subs}
          hourly={v.hours ? hourlyNights(v.hours) : null}
          persist="nights"
          onInteraction={setTouching}
        />
      </View>
      <Text style={[type.small, s.pad, { color: color.faint }]}>
        A wallet signing at night is strong evidence of a person awake, not proof: a bot holding the key or a scheduled order signs too.
      </Text>
    </ScrollView>
  );
}

/** An hourly chart's panes: the time axis and what to draw on it. */
interface Hourly {
  t: number[];
  main: Pane;
  subs: Pane[];
}

/**
 * A wallet chart, hourly, nightly or weekly. Hourly is the last 30 days on
 * the reader's own clock, from each transaction's timestamp. Weekly is each
 * week's mean night: the load a night averaged, and for the after-midnight
 * bars, the share of that week's nights awake.
 */
function Resolved({
  t,
  days,
  main,
  subs,
  hourly,
  persist,
  onInteraction,
}: {
  t: number[];
  days: string[];
  main: Pane;
  subs: Pane[];
  hourly: Hourly | null;
  /** The chart's name for its remembered resolution and window. */
  persist: string;
  onInteraction: (a: boolean) => void;
}) {
  const [resRaw, setRes] = usePref<"h" | "d" | "w">(`${persist}:res`, "d");
  const res = oneOf(resRaw, hourly ? ["h", "d", "w"] : ["d", "w"], "d");
  const w = useMemo(() => (res === "w" ? toWeekly(days, [main, ...subs]) : null), [res, days, main, subs]);
  const shown =
    res === "h" && hourly
      ? { t: hourly.t, main: hourly.main, subs: hourly.subs, time: "intraday" as const, presets: HOUR_PRESETS, initial: 168 }
      : w
        ? { t: w.days.map(dayMs), main: w.panes[0], subs: w.panes.slice(1), time: "weekly" as const, presets: WEEK_PRESETS, initial: 100_000 }
        : { t, main, subs, time: "daily" as const, presets: PRESETS, initial: 100_000 };
  return (
    <View style={{ gap: space.s }}>
      <ResToggle
        options={[...(hourly ? [{ key: "h" as const, label: "Hourly" }] : []), { key: "d" as const, label: "Nightly" }, { key: "w" as const, label: "Weekly" }]}
        value={res}
        onChange={setRes}
      />
      <ProChart
        key={res}
        t={shown.t}
        main={shown.main}
        subs={shown.subs}
        time={shown.time}
        initialCount={shown.initial}
        presets={shown.presets}
        persist={`${persist}:${res}`}
        onInteraction={onInteraction}
      />
    </View>
  );
}

/** Local hours from 22:00 to 05:00: the late part of the night. */
const lateHour = (ms: number) => {
  const h = new Date(ms).getHours();
  return h >= 22 || h < 5;
};

function hourlyLoad(hours: HourBucket[], subs: SubKey[]): Hourly {
  const sub = (k: "swaps" | "usd" | "count"): Pane => {
    const d = SUB.find((x) => x.key === k)!;
    const values = hours.map((h) => h[k]);
    return {
      key: k,
      title: d.label,
      height: 80,
      lines: [{ key: k, label: d.label, values, color: d.color, kind: "bars" }],
      domain: d.format === count ? countDomain(values) : undefined,
      format: d.format,
    };
  };
  return {
    t: hours.map((h) => h.t),
    main: {
      key: "main",
      height: 220,
      lines: [{ key: "load", label: "Share swapped in the hour", values: hours.map((h) => h.share), color: color.wallet, kind: "bars" }],
      format: pct,
    },
    // "After 22:00" is a nightly count; by the hour, the late hours are coloured on the Nights chart instead.
    subs: subs.filter((k): k is "swaps" | "usd" | "count" => k !== "late").map(sub),
  };
}

function hourlyNights(hours: HourBucket[]): Hourly {
  return {
    t: hours.map((h) => h.t),
    main: {
      key: "main",
      height: 170,
      lines: [
        {
          key: "count",
          label: "Signed in the hour",
          values: hours.map((h) => h.count),
          color: "#C678DD",
          kind: "bars",
          barColors: hours.map((h) => (lateHour(h.t) ? "#C678DD" : color.muted)),
        },
      ],
      domain: countDomain(hours.map((h) => h.count)),
      format: count,
    },
    subs: [],
  };
}

const s = StyleSheet.create({
  content: { paddingBottom: space.xxl, gap: space.m },
  pad: { paddingHorizontal: space.l },
  value: { fontSize: 30, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  tabs: { paddingHorizontal: space.s },
  clockRow: { flexDirection: "row", alignItems: "center", gap: space.l },
});
