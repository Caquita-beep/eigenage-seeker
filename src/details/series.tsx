import { Stack } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { dayMs } from "../candles";
import { CORR_DAYS, correlations, signedR, strength } from "../correlation";
import { useMarket } from "../data";
import { align, type Line, type Values } from "../indicators";
import { bandPill, fngColor, fngWord, premiumSeries } from "../labels";
import type { MarketView } from "../market";
import { fetchDvolHourly } from "../intraday";
import { oneOf, toggled, usePref } from "../prefs";
import { ProChart, Tabs, type Pane, type TimeKind } from "../prochart";
import { HOUR_PRESETS, toWeekly, WEEK_PRESETS } from "../resample";
import { color, space, type } from "../theme";
import { Dial, fmt, Pill, ResToggle, Source } from "../ui";

/**
 * The full chart for one daily market series. Each id picks its lines, its
 * optional comparisons (toggled under the chart) and its source; the page
 * around them is the same for all of them.
 */

export type SeriesId = "dvol" | "premium" | "solindex" | "fng" | "corr";

const PRESETS = [
  { label: "1M", count: 30 },
  { label: "3M", count: 91 },
  { label: "6M", count: 182 },
  { label: "1Y", count: 365 },
  { label: "2Y", count: 730 },
  { label: "All", count: 100_000 },
];

const vol = (v: number) => v.toFixed(1);
const SOLC = "#56B6C2";

interface Built {
  title: string;
  head: ReactNode;
  days: string[];
  main: Pane;
  subs: Pane[];
  toggles: { key: string; label: string }[];
  about: ReactNode;
  source: ReactNode;
  initial: number;
}

function build(id: SeriesId, v: MarketView, on: Set<string>): Built {
  const rv = (pts: [string, number][], days: string[]) => align(days, new Map(pts));

  if (id === "dvol" || id === "premium") {
    const days = v.dvolSeries.map((d) => d.day);
    const lines: Line[] = [{ key: "dvol", label: "DVOL", values: v.dvolSeries.map((d) => d.value), color: color.market, kind: "area", width: 1.6 }];
    if (on.has("btc")) lines.push({ key: "btc", label: "BTC realised", values: rv(v.btcRealisedSeries, days), color: color.muted });
    if (on.has("sol")) lines.push({ key: "sol", label: "SOL realised", values: rv(v.solRealisedSeries, days), color: SOLC });
    const bands = on.has("band")
      ? [{ key: "band", low: v.dvolSeries.map((d) => d.low), high: v.dvolSeries.map((d) => d.high), color: color.market }]
      : [];
    const subs: Pane[] = [];
    if (on.has("premium")) {
      const p: Values = rv(premiumSeries(v), days);
      subs.push({
        key: "premium",
        title: "Premium",
        height: 100,
        lines: [{ key: "premium", label: "DVOL − BTC realised", values: p, color: color.market, kind: "bars", barColors: p.map((x) => ((x ?? 0) >= 0 ? color.market : color.below)) }],
        guides: [0],
        format: (x) => `${x > 0 ? "+" : ""}${x.toFixed(1)}`,
      });
    }
    const isPremium = id === "premium";
    return {
      title: isPremium ? "Fear premium" : "DVOL",
      days,
      main: { key: "main", height: 260, lines, bands, format: vol },
      subs,
      toggles: [
        { key: "band", label: "60-day normal" },
        { key: "btc", label: "BTC realised" },
        { key: "sol", label: "SOL realised" },
        { key: "premium", label: "Premium" },
      ],
      initial: 365,
      head: isPremium ? (
        <Head value={v.premium === null ? "–" : `${v.premium > 0 ? "+" : ""}${v.premium.toFixed(1)}`} sub="DVOL minus BTC's realised volatility, in vol points" />
      ) : (
        <Head
          value={v.dvol ? v.dvol.value.toFixed(1) : "–"}
          sub="BTC's implied volatility for the next 30 days, annualised"
          pill={v.dvol ? bandPill[v.dvol.position] : undefined}
        />
      ),
      about: (
        <>
          <P>
            DVOL is what traders pay, through options, to insure against the next month's swings. Realised volatility is the size of the
            swings the last month actually delivered. When the first runs above the second, the market is paying for fear that has not
            happened yet; that gap is the premium.
          </P>
          <P>
            The shaded band is DVOL's own normal: the 60-day mean plus and minus half a standard deviation, the same instrument Exposure uses
            on the body. Outside it is unusual for the market, not just high.
          </P>
        </>
      ),
      source: (
        <Source
          links={[
            { label: "Deribit DVOL methodology", url: "https://insights.deribit.com/exchange-updates/dvol-deribit-implied-volatility-index/" },
            { label: "Binance daily candles", url: "https://data.binance.vision/" },
          ]}
        >
          Realised volatility is the Parkinson estimator on 30 days of daily highs and lows, annualised
        </Source>
      ),
    };
  }

  if (id === "solindex") {
    const days = v.solRealisedSeries.map((p) => p[0]);
    const lines: Line[] = [
      { key: "rv", label: "SOL realised", values: v.solRealisedSeries.map((p) => p[1]), color: color.muted, width: 1.4 },
      { key: "idx", label: "SOL index", values: rv(v.solIndexHistory, days), color: color.market, kind: "dots" },
    ];
    if (on.has("dvol")) lines.push({ key: "dvol", label: "DVOL (BTC)", values: align(days, new Map(v.dvolSeries.map((d) => [d.day, d.value]))), color: "#9B6BF2" });
    return {
      title: "SOL volatility index",
      days,
      main: { key: "main", height: 260, lines, format: vol },
      subs: [],
      toggles: [{ key: "dvol", label: "DVOL (BTC)" }],
      initial: 182,
      head: (
        <Head
          value={v.solIndex ? v.solIndex.value.toFixed(1) : "–"}
          sub={v.solIndex ? `Implied, 30 days, from the ${v.solIndex.near} and ${v.solIndex.next} expiries` : "Options book unavailable"}
          right={`Realised ${fmt.vol(v.solRealised)}`}
        />
      ),
      about: (
        <>
          <P>
            No venue publishes a volatility index for SOL, so EigenAge computes one from Deribit's SOL options the way the VIX is computed:
            every out-of-the-money strike, not one at-the-money quote, interpolated to exactly 30 days.
          </P>
          <P>
            Deribit keeps no history of its options book, so the index only has a past if somebody records it. This phone records one value a
            day, drawn as dots over SOL's realised volatility. {v.solIndexHistory.length}{" "}
            {v.solIndexHistory.length === 1 ? "day" : "days"} so far.
          </P>
        </>
      ),
      source: (
        <Source
          links={[
            { label: "Deribit SOL options", url: "https://www.deribit.com/options/SOL" },
            { label: "Cboe VIX methodology", url: "https://cdn.cboe.com/api/global/us_indices/governance/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf" },
          ]}
        >
          Computed on this phone by variance-swap replication, rates taken as zero
        </Source>
      ),
    };
  }

  if (id === "corr") {
    const c = correlations(v);
    const days = [...new Set([...c.solBtc.map((p) => p[0]), ...c.solFear.map((p) => p[0])])].sort();
    const btc = c.solBtc.at(-1)?.[1];
    const fear = c.solFear.at(-1)?.[1];
    return {
      title: "Correlations",
      days,
      main: {
        key: "main",
        height: 260,
        lines: [
          { key: "btc", label: "SOL ↔ BTC", values: align(days, new Map(c.solBtc)), color: SOLC, width: 1.6 },
          { key: "fear", label: "SOL ↔ fear", values: align(days, new Map(c.solFear)), color: color.market, width: 1.6 },
        ],
        domain: [-1, 1],
        guides: [0],
        format: signedR,
      },
      subs: [],
      toggles: [],
      initial: 182,
      head: (
        <Head
          value={btc !== undefined ? signedR(btc) : "–"}
          pill={btc !== undefined ? { text: strength(btc), tint: "#3A3F48" } : undefined}
          sub={`SOL with BTC, daily moves over ${CORR_DAYS} days`}
          right={fear !== undefined ? `With fear ${signedR(fear)}` : undefined}
        />
      ),
      about: (
        <>
          <P>
            Each day, how closely the moves of the last {CORR_DAYS} days went together: +1 always the same way, −1 always opposite, 0 no relation.
            Daily moves, not prices, since two prices that trend over the same months look related by drift alone.
          </P>
          <P>
            SOL ↔ BTC: when it is high, SOL is mostly riding the whole market, and a view on SOL is a view on crypto. SOL ↔ fear: the move in SOL
            against the change in DVOL that day. It is usually negative, prices falling as priced fear rises; when it nears zero, fear and SOL have
            come apart.
          </P>
        </>
      ),
      source: (
        <Source
          links={[
            { label: "Binance spot klines, SOL/USDT and BTC/USDT", url: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" },
            { label: "Deribit DVOL", url: "https://www.deribit.com/statistics/BTC/volatility-index" },
          ]}
        >
          Pearson correlation of daily log returns, and of the daily change in DVOL, computed on this phone
        </Source>
      ),
    };
  }

  // fng
  const days = v.fngSeries.map((p) => p[0]);
  const subs: Pane[] = [];
  if (on.has("sol")) {
    subs.push({
      key: "sol",
      title: "SOL",
      height: 100,
      lines: [{ key: "sol", label: "SOL/USDT", values: align(days, new Map(v.solBars.map((b) => [b.day, b.close]))), color: SOLC }],
      format: (x) => x.toFixed(2),
    });
  }
  if (on.has("dvol")) {
    subs.push({
      key: "dvol",
      title: "DVOL",
      height: 90,
      lines: [{ key: "dvol", label: "DVOL", values: align(days, new Map(v.dvolSeries.map((d) => [d.day, d.value]))), color: color.market }],
      format: vol,
    });
  }
  return {
    title: "Fear & Greed",
    days,
    main: {
      key: "main",
      height: 240,
      lines: [{ key: "fng", label: "Index", values: v.fngSeries.map((p) => p[1]), color: color.text, width: 1.3 }],
      domain: [0, 100],
      guides: [25, 75],
      zones: [
        { from: 0, to: 25, color: color.below },
        { from: 75, to: 100, color: color.body },
      ],
      format: (x) => x.toFixed(0),
    },
    subs,
    toggles: [
      { key: "sol", label: "SOL price" },
      { key: "dvol", label: "DVOL" },
    ],
    initial: 365,
    head: v.fng ? (
      <View style={s.fngHead}>
        <Dial value={v.fng.value} size={120} />
        <View style={{ gap: 4 }}>
          <Text style={s.value}>{v.fng.value}</Text>
          <Pill text={fngWord(v.fng.value)} tint={fngColor(v.fng.value)} />
          <Text style={type.small}>{v.fng.day}</Text>
        </View>
      </View>
    ) : (
      <Head value="–" sub="alternative.me did not answer" />
    ),
    about: (
      <P>
        Volatility rises in euphoric spikes and in crashes alike. This index tells the two apart. Below 25 is extreme fear, above 75 extreme
        greed. A quarter of it is itself volatility, so it is never read beside realised volatility as if it were separate evidence.
      </P>
    ),
    source: (
      <Source links={[{ label: "Crypto Fear & Greed Index, alternative.me", url: "https://alternative.me/crypto/fear-and-greed-index/" }]}>
        Bitcoin only, daily since 1 February 2018. Built from volatility (25%), market momentum and volume (25%), social media (15%),
        surveys (15%, currently paused), bitcoin dominance (10%) and Google Trends (10%)
      </Source>
    ),
  };
}

const DEFAULT_ON: Record<SeriesId, string[]> = {
  dvol: ["band", "btc"],
  premium: ["btc", "premium"],
  solindex: [],
  fng: [],
  corr: [],
};

type Res = "1h" | "1d" | "1w";

/**
 * Resolutions each chart offers. Hourly only where the source publishes it:
 * Deribit serves DVOL by the hour; Fear & Greed is published once a day, and
 * the premium and the SOL index are built from daily figures, so an hourly
 * view of them would only repeat each day's number 24 times.
 */
const RES: Record<SeriesId, Res[]> = { dvol: ["1h", "1d", "1w"], premium: ["1d", "1w"], solindex: ["1d", "1w"], fng: ["1d", "1w"], corr: ["1d", "1w"] };
const RES_LABEL: Record<Res, string> = { "1h": "Hourly", "1d": "Daily", "1w": "Weekly" };

export function SeriesDetail({ id }: { id: SeriesId }) {
  const { view } = useMarket();
  // Layers, resolution and window are remembered per chart (`prefs.ts`).
  const [onList, setOn] = usePref<string[]>(`${id}:layers`, DEFAULT_ON[id]);
  const on = useMemo(() => new Set(onList), [onList]);
  const [touching, setTouching] = useState(false);
  const [resRaw, setRes] = usePref<Res>(`${id}:res`, "1d");
  const res = oneOf(resRaw, RES[id], "1d");
  const [hourly, setHourly] = useState<[number, number][] | null>(null);
  const [hourlyError, setHourlyError] = useState<string | null>(null);
  const b = useMemo(() => (view ? build(id, view, on) : null), [id, view, on]);
  const t = useMemo(() => b?.days.map(dayMs) ?? [], [b?.days]);

  useEffect(() => {
    if (res !== "1h" || hourly) return;
    fetchDvolHourly()
      .then(setHourly)
      .catch((e) => setHourlyError(e instanceof Error ? e.message : String(e)));
  }, [res, hourly]);

  const chart = useMemo(() => {
    if (!b) return null;
    if (res === "1w") {
      const w = toWeekly(b.days, [b.main, ...b.subs]);
      return { t: w.days.map(dayMs), main: w.panes[0], subs: w.panes.slice(1), time: "weekly" as TimeKind, initial: Math.ceil(b.initial / 7), presets: WEEK_PRESETS };
    }
    if (res === "1h") {
      if (!hourly) return null;
      const main: Pane = {
        ...b.main,
        bands: undefined,
        lines: [{ key: "dvol", label: "DVOL, hourly", values: hourly.map((p) => p[1]), color: color.market, kind: "area", width: 1.6 }],
      };
      return { t: hourly.map((p) => p[0]), main, subs: [] as Pane[], time: "intraday" as TimeKind, initial: 168, presets: HOUR_PRESETS };
    }
    return { t, main: b.main, subs: b.subs, time: "daily" as TimeKind, initial: b.initial, presets: PRESETS };
  }, [b, res, hourly, t]);

  if (!b) return <Stack.Screen options={{ title: "" }} />;
  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: b.title }} />
      <View style={s.pad}>{b.head}</View>
      <ResToggle options={RES[id].map((r) => ({ key: r, label: RES_LABEL[r] }))} value={res} onChange={setRes} />
      <View style={s.chart}>
        {chart ? (
          <ProChart
            key={res}
            t={chart.t}
            main={chart.main}
            subs={chart.subs}
            time={chart.time}
            initialCount={chart.initial}
            presets={chart.presets}
            persist={`${id}:${res}`}
            onInteraction={setTouching}
          />
        ) : (
          <Text style={[type.small, { padding: space.l }]}>{hourlyError ? `Hourly data unavailable: ${hourlyError}` : "Loading hourly data…"}</Text>
        )}
      </View>
      {b.toggles.length ? (
        <View style={s.tabs}>
          <Tabs
            items={b.toggles}
            on={(k) => on.has(k)}
            onPress={(k) => setOn((prev) => toggled(prev, k))}
          />
        </View>
      ) : null}
      <View style={[s.pad, { gap: space.m }]}>
        {b.source}
        {b.about}
        <Text style={[type.small, { color: color.faint }]}>Drag to move through time, pinch to zoom, tap for the crosshair.</Text>
      </View>
    </ScrollView>
  );
}

function Head({ value, sub, pill, right }: { value: string; sub: string; pill?: { text: string; tint: string }; right?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <Text style={s.value}>{value}</Text>
        {pill ? <Pill {...pill} /> : null}
        {right ? <Text style={[type.small, { marginLeft: "auto" }]}>{right}</Text> : null}
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
  fngHead: { flexDirection: "row", alignItems: "center", gap: space.l },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  tabs: { paddingHorizontal: space.s },
});
