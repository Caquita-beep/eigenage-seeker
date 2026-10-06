import { Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { fetchCandles, type Candle, type Interval } from "../candles";
import { coinInfo, fetchCoinCandles, fetchQuotes, knownCoin, recentQuote, watchCoinCandles, type CoinFrame, type Quote } from "../coins";
import { readBody } from "../bodyview";
import { useBody, useWalletData } from "../data";
import { SOL } from "../engine/wallet";
import { BAR_MS, markersFor } from "../markers";
import { averageCost, water } from "../engine/cost";
import { DOWN, MAIN, SUBS, UP, type Line } from "../indicators";
import { oneOf, toggled, usePref } from "../prefs";
import { ProChart, Tabs, type Pane, type TimeKind } from "../prochart";
import { color, space, type } from "../theme";
import { Source } from "../ui";
import { BODY_INDICATORS, bodyPaneOn, bodyPaneOnWeeks } from "./body";

type Frame = "line" | Exclude<Interval, "1m">;

const FRAMES: { key: Frame; label: string }[] = [
  { key: "line", label: "Line" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1h" },
  { key: "4h", label: "4h" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
];

const INITIAL: Record<Frame, number> = { line: 180, "15m": 96, "1h": 96, "4h": 90, "1d": 90, "1w": 80 };
const KIND: Record<Frame, TimeKind> = { line: "intraday", "15m": "intraday", "1h": "intraday", "4h": "intraday", "1d": "daily", "1w": "weekly" };

const price = (v: number) =>
  Math.abs(v) >= 1000 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : Math.abs(v) >= 0.01 ? v.toFixed(4) : v.toPrecision(3);
const amount = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 1 ? 2 : 4));
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));

type MainKey = (typeof MAIN)[number]["key"];

/** Coins other than SOL come from DEX pools, at the four resolutions those serve. */
const COIN_FRAMES = FRAMES.filter((f) => f.key === "15m" || f.key === "1h" || f.key === "4h" || f.key === "1d");

/**
 * A frame's candles: Binance for SOL's minute and weekly bars; for the rest,
 * what the phone already has at once, then the latest (`coins.ts`).
 */
function watchFrame(mint: string, frame: Frame, on: (c: Candle[]) => void, onError: (e: unknown) => void): () => void {
  if (mint === SOL && (frame === "line" || frame === "1w")) {
    let live = true;
    fetchCandles("SOLUSDT", frame === "line" ? "1m" : frame)
      .then((c) => live && on(c))
      .catch((e) => live && onError(e));
    return () => {
      live = false;
    };
  }
  return watchCoinCandles(mint, frame as CoinFrame, on, onError);
}

/**
 * The price chart for SOL or any coin the wallet holds, with the reader's own
 * trades of that coin marked on it: ▲ where they bought, ▼ where they sold.
 *
 * Each coin remembers its own timeframe and window; the indicators are one
 * set for every price chart, as on an exchange (`prefs.ts`).
 */
export function PriceDetail({ mint = SOL }: { mint?: string }) {
  const isSol = mint === SOL;
  const [symbol, setSymbol] = useState(knownCoin(mint)?.symbol ?? "");
  const { view: wallet } = useWalletData();
  const pos = useMemo(() => wallet?.cost?.now.find((p) => p.mint === mint) ?? null, [wallet, mint]);
  const chartKey = isSol ? "price:sol" : `price:${mint}`;
  const frames = isSol ? FRAMES : COIN_FRAMES;
  const [frameRaw, setFrame] = usePref<Frame>(`${chartKey}:frame`, "1d");
  const frame = oneOf(frameRaw, frames.map((f) => f.key), "1d");
  const [mainRaw, setMain] = usePref<MainKey | null>("price:main", "MA");
  const main = oneOf(mainRaw, [null, ...MAIN.map((m) => m.key)], "MA");
  const [subsRaw, setSubs] = usePref<string[]>("price:subs", ["VOL"]);
  const subs = subsRaw.filter((k) => SUBS.some((d) => d.key === k) || BODY_INDICATORS.some((d) => `body:${d.id}` === k));
  const { body } = useBody();
  const read = useMemo(() => (body ? readBody(body) : null), [body]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [day, setDay] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touching, setTouching] = useState(false);
  const { height: screenH } = useWindowDimensions();

  useEffect(() => {
    setCandles(null);
    setError(null);
    return watchFrame(mint, frame, setCandles, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [frame, mint]);

  // Price and 24h change from the quote the coin list just fetched, so the header is filled at once.
  const [quote, setQuote] = useState<Quote | null>(() => recentQuote(mint));
  useEffect(() => {
    let live = true;
    fetchQuotes([mint])
      .then((q) => live && q[mint] && setQuote(q[mint]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mint]);

  useEffect(() => {
    if (!symbol) coinInfo(mint).then((c) => setSymbol(c.symbol)).catch(() => {});
  }, [mint, symbol]);

  // The last 24 hours' high, low and volume, from hourly candles, behind the chart's own.
  useEffect(() => {
    let live = true;
    fetchCoinCandles(mint, "1h", false)
      .then((c) => live && setDay(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mint]);

  const stats = useMemo(() => {
    if (!day || day.length < 25) return null;
    const last = day.slice(-24);
    const now = day[day.length - 1].c;
    const ref = day[day.length - 25].c;
    return {
      now,
      change: ((now - ref) / ref) * 100,
      high: Math.max(...last.map((c) => c.h)),
      low: Math.min(...last.map((c) => c.l)),
      vol: last.reduce((s, c) => s + c.v, 0),
    };
  }, [day]);

  const daily = frame === "1d";
  const weekly = frame === "1w";
  const shownSubs = SUBS.filter((d) => subs.includes(d.key) && (!d.daily || daily));
  // The body's indicators: one value a night, so daily candles, or weekly ones as each week's average.
  const bodyTabs = (daily || weekly) && body ? BODY_INDICATORS.filter((d) => d.has(body)) : [];
  const shownBody = bodyTabs.filter((d) => subs.includes(`body:${d.id}`));
  const paneCount = shownSubs.length + shownBody.length;

  const chart = useMemo(() => {
    if (!candles?.length) return null;
    const closes = candles.map((c) => c.c);
    const lines: Line[] = [];
    if (frame === "line") lines.push({ key: "close", label: "Price", values: closes, color: "#F0B90B", kind: "area", width: 1.4 });
    const m = MAIN.find((x) => x.key === main);
    if (m) lines.push(...m.lines(closes));
    // Fit the chart to the screen so the indicator bar under it stays in view:
    // each pane added takes its height from the price pane, down to a floor.
    // Past that floor the page scrolls, which the chart now allows.
    const subH = paneCount > 2 ? 64 : 80;
    const room = screenH - 330 - paneCount * (subH + 18);
    const t = candles.map((c) => c.t);
    const markers = markersFor(t, frame === "line" ? 60_000 : BAR_MS[frame], wallet?.trades, mint);
    // The reader's average cost, across the chart: above it, the position is in profit; below, underwater.
    const avg = pos ? averageCost(pos) : null;
    const levels = avg !== null ? [{ value: avg, label: "Your avg cost", color: "#F0B90B" }] : undefined;
    const mainPane: Pane = { key: "main", height: Math.max(170, Math.min(320, room)), lines, format: price, markers, levels };
    const subPanes: Pane[] = shownSubs.map((d) => ({
      key: d.key,
      title: d.title,
      height: subH,
      lines: d.lines(candles),
      domain: d.domain,
      guides: d.guides,
      format: d.format,
    }));
    if (body && read && shownBody.length) {
      const days = candles.map((c) => new Date(c.t).toISOString().slice(0, 10));
      for (const d of shownBody) subPanes.push(weekly ? bodyPaneOnWeeks(d.id, body, read, days, subH) : bodyPaneOn(d.id, body, read, days, subH));
    }
    return { t, mainPane, subPanes, markers: markers.length };
  }, [candles, frame, main, subs.join(), daily, weekly, screenH, wallet?.trades, mint, pos, body, read]);

  const holding = wallet?.holdings?.find((h) => h.mint === mint);
  const myTrades = wallet?.trades?.filter((x) => x.mint === mint) ?? [];

  // The hourly candles' figures once they are in; until then the quote's.
  const now = stats?.now ?? quote?.price ?? null;
  const change = stats?.change ?? quote?.change24h ?? null;
  const up = (change ?? 0) >= 0;
  const w = pos && now !== null ? water(pos, now) : null;
  const toggleSub = (k: string) => setSubs((prev) => toggled(prev, k));

  return (
    <ScrollView scrollEnabled={!touching} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: isSol ? "SOL/USDT" : symbol ? `${symbol}/USD` : "" }} />

      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={[s.price, { color: up ? UP : DOWN }]}>{now !== null ? price(now) : "–"}</Text>
          <Text style={[s.change, { color: up ? UP : DOWN }]}>
            {change !== null ? `${up ? "+" : ""}${change.toFixed(2)}%` : " "}
          </Text>
        </View>
        <View style={s.stats}>
          <Stat k="24h High" v={stats ? price(stats.high) : "–"} />
          <Stat k="24h Low" v={stats ? price(stats.low) : "–"} />
          <Stat k={isSol ? "24h Vol (SOL)" : "24h Vol"} v={stats ? compact(stats.vol) : "–"} />
        </View>
      </View>

      {holding || myTrades.length ? (
        <View style={s.mine}>
          {holding ? (
            <Text style={type.small}>
              You hold <Text style={{ color: color.text, fontWeight: "600" }}>{amount(holding.amount)} {symbol}</Text>
              {now !== null ? <Text>, about ${(holding.amount * now).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text> : null}
            </Text>
          ) : null}
          {pos && averageCost(pos) !== null ? (
            <Text style={s.cost}>
              Your avg cost ${price(averageCost(pos)!)}
              {w ? (
                <Text style={{ color: w.pct < 0 ? DOWN : UP }}>
                  {"  "}
                  {w.pct < 0 ? "▼" : "▲"} {Math.abs(100 * w.pct).toFixed(1)}% {w.pct < 0 ? "underwater" : "above cost"} · {w.gain < 0 ? "−" : "+"}$
                  {Math.abs(w.gain).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </Text>
              ) : null}
            </Text>
          ) : null}
          {myTrades.length ? (
            <Text style={type.small}>
              <Text style={{ color: UP }}>▲ {myTrades.filter((x) => x.side === "buy").length} buys</Text>
              {"  "}
              <Text style={{ color: DOWN }}>▼ {myTrades.filter((x) => x.side === "sell").length} sells</Text>
              {"  "}in your history{chart && chart.markers < myTrades.length ? `, ${chart.markers} in this view` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={s.tabs}>
        <Tabs items={frames} on={(k) => k === frame} onPress={setFrame} />
      </View>

      <View style={s.chart}>
        {chart ? (
          <ProChart
            key={frame}
            t={chart.t}
            candles={frame === "line" ? undefined : candles!}
            main={chart.mainPane}
            subs={chart.subPanes}
            time={KIND[frame]}
            initialCount={INITIAL[frame]}
            maxCount={frame === "line" ? 500 : 300}
            persist={`${chartKey}:${frame}`}
            onInteraction={setTouching}
          />
        ) : (
          <View style={s.wait}>{error ? <Text style={[type.small, { color: DOWN }]}>{error}</Text> : <ActivityIndicator color={color.muted} />}</View>
        )}
      </View>

      <View style={s.tabs}>
      <Tabs<string>
        items={[
          ...MAIN.map((m) => ({ key: m.key as string, label: m.key })),
          ...SUBS.filter((d) => !d.daily).map((d, i) => ({ key: d.key, label: d.key, sep: i === 0 })),
          ...(daily ? SUBS.filter((d) => d.daily).map((d, i) => ({ key: d.key, label: d.title, sep: i === 0 })) : []),
          ...bodyTabs.map((d, i) => ({ key: `body:${d.id}`, label: d.label, sep: i === 0 })),
        ]}
        on={(k) => k === main || subs.includes(k)}
        onPress={(k) => {
          if (MAIN.some((m) => m.key === k)) setMain((prev) => (prev === k ? null : (k as MainKey)));
          else toggleSub(k);
        }}
      />
      </View>

      <View style={s.notes}>
        <Text style={type.small}>
          Drag to move through time, pinch to zoom, tap for the crosshair. MA and EMA are 7, 25 and 99 periods; BOLL is 20 periods at 2
          standard deviations; RSI is 6, 12 and 24.
        </Text>
        {!daily ? (
          <Text style={type.small}>
            Switch to 1D for Exposure's own indicators: surprise, intraday swing and drawdown{body && !weekly ? ", and your body's" : ""}.
          </Text>
        ) : (
          shownSubs
            .filter((d) => d.why)
            .map((d) => (
              <Text key={d.key} style={type.small}>
                <Text style={{ color: color.text }}>{d.title}. </Text>
                {d.why}
              </Text>
            ))
        )}
        {shownBody.length ? (
          <Text style={type.small}>
            <Text style={{ color: color.text }}>Body. </Text>
            {weekly
              ? "Each week's average of its nights, under the week's candle. The white line is that average; the band is your normal range, with its 60-day average dashed."
              : "Each night sits under the day it began, so this morning's reading is under yesterday's candle. The green curve is each night; the white line is the 7-day average your Body status is read from; the band is your normal range, with its 60-day average dashed."}
          </Text>
        ) : null}
        {isSol ? (
          <Source links={[{ label: "Binance spot SOL/USDT klines", url: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" }]}>
            Intraday candles are in your local time; daily and weekly candles open at 00:00 UTC. The newest candle is still forming. When Binance
            cannot be reached, SOL's own DEX pools stand in
          </Source>
        ) : (
          <Source links={[{ label: "GeckoTerminal, Solana DEX pools", url: "https://www.geckoterminal.com/solana/pools" }]}>
            Candles from the coin's deepest pool on Solana, priced in USD. Intraday candles are in your local time; daily candles open at 00:00
            UTC
          </Source>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statK}>{k}</Text>
      <Text style={s.statV}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  header: { flexDirection: "row", paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m, gap: space.m },
  price: { fontSize: 30, fontWeight: "600", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  change: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  stats: { gap: 3, justifyContent: "center" },
  stat: { flexDirection: "row", justifyContent: "space-between", gap: space.m, minWidth: 150 },
  statK: { fontSize: 11, color: "#848E9C" },
  statV: { fontSize: 11, color: color.text, fontVariant: ["tabular-nums"] },
  chart: { paddingHorizontal: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingVertical: space.xs },
  wait: { height: 420, alignItems: "center", justifyContent: "center" },
  tabs: { paddingHorizontal: space.s },
  notes: { paddingHorizontal: space.l, gap: space.s, paddingTop: space.s },
  mine: { paddingHorizontal: space.l, paddingBottom: space.s, gap: 2 },
  cost: { fontSize: 14.5, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
});
