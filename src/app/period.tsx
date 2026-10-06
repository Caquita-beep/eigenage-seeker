import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useExposure, useMarket } from "../data";
import { addDays } from "../engine/nights";
import { SOL } from "../engine/wallet";
import { DOWN, UP } from "../indicators";
import { BODY, TONE_COLOR, type Tone } from "../insight";
import { byCoin, money, morning, notes, periodLabel, signed, story, symbolOf, toneOf, useJournal, type Fill, type PeriodKind } from "../journalread";
import { periodEnd, summarise } from "../engine/journal";
import { color, space, type } from "../theme";

const toneColor = (t: Tone) => (t === "neutral" ? color.muted : TONE_COLOR[t]);
const amount = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 1 ? 2 : 4));
const dayName = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * One day, week or month of the journal: the story, the notes, the coins,
 * then night by night — the morning's state, SOL's day, and every trade, each
 * one tap from its coin's chart.
 */
export default function PeriodScreen() {
  const { kind = "week", start = "" } = useLocalSearchParams<{ kind: PeriodKind; start: string }>();
  const { journal: j } = useJournal();
  const { view: market } = useMarket();
  const { data } = useExposure();

  const p = useMemo(() => {
    if (!j || !start) return null;
    const end = periodEnd(start, kind);
    return summarise(start, end, j.ledger.fills.filter((f) => f.night >= start && f.night <= end));
  }, [j, start, kind]);

  const close = useMemo(() => new Map((market?.solBars ?? []).map((b) => [b.day, b.close])), [market]);

  if (!j || !p) return <Stack.Screen options={{ title: "" }} />;
  const st = story(j, p, market, data);
  const nights: string[] = [];
  for (let d = p.end; d >= p.start; d = addDays(d, -1)) if (p.fills.some((f) => f.night === d) || kind !== "month") nights.push(d);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: periodLabel(p, kind) }} />

      <View style={s.card}>
        <View style={s.figs}>
          <Fig label="Trades" value={`${p.fills.length}`} />
          <Fig label="Traded" value={money(p.volume)} />
          <Fig label="Realised" value={Math.abs(p.realised) >= 1 ? signed(p.realised) : "$0"} tint={toneColor(toneOf(p.realised))} />
        </View>
        {st.market ? <Line k="Market" v={st.market} /> : null}
        <Line k="You" v={st.you} />
        {st.body ? <Line k="Body" v={st.body} /> : null}
        {st.join ? <Text style={s.join}>{st.join}</Text> : null}
        {notes(j, p).map((n) => (
          <Text key={n} style={[type.small, { color: color.muted }]}>
            · {n}
          </Text>
        ))}
      </View>

      {p.fills.length ? (
        <View style={s.card}>
          <Text style={type.label}>By coin</Text>
          {byCoin(j, p).map((c) => (
            <View key={c.mint} style={s.coinRow}>
              <Text style={s.coin}>{c.symbol}</Text>
              <Text style={s.cell}>{c.trades}</Text>
              <Text style={s.cell}>{money(c.volume)}</Text>
              <Text style={[s.cell, { color: toneColor(toneOf(c.realised)) }]}>{Math.abs(c.realised) >= 1 ? signed(c.realised) : "–"}</Text>
            </View>
          ))}
          <Text style={s.caption}>Trades · traded · realised</Text>
        </View>
      ) : null}

      {nights.map((d) => {
        const m = morning(j, d);
        const a = close.get(addDays(d, -1));
        const b = close.get(d);
        const fills = p.fills.filter((f) => f.night === d);
        return (
          <View key={d} style={s.day}>
            <View style={s.dayHead}>
              <Text style={s.dayName}>{dayName(d)}</Text>
              {m ? (
                <View style={s.state}>
                  <View style={[s.dot, { backgroundColor: TONE_COLOR[BODY[m.response].tone] }]} />
                  <Text style={[type.small, { color: TONE_COLOR[BODY[m.response].tone] }]}>{BODY[m.response].state}</Text>
                </View>
              ) : null}
              {a && b ? <Text style={[type.small, { color: b >= a ? UP : DOWN }]}>SOL {b >= a ? "+" : "−"}{Math.abs(100 * (b / a - 1)).toFixed(1)}%</Text> : null}
            </View>
            {fills.length ? fills.map((f) => <TradeRow key={f.i} f={f} symbol={symbolOf(j, f.mint)} />) : <Text style={s.quiet}>No trades</Text>}
          </View>
        );
      })}
      <Text style={[s.caption, { paddingHorizontal: space.l }]}>
        Each night runs from 18:00 to 05:00, so a 2 a.m. trade sits with the evening before. The state is that morning's assessment, as Today showed it.
      </Text>
    </ScrollView>
  );
}

function TradeRow({ f, symbol }: { f: Fill; symbol: string }) {
  return (
    <Pressable onPress={() => router.push((f.mint === SOL ? "/chart/sol" : `/chart/coin?mint=${f.mint}`) as never)} style={({ pressed }) => [s.trade, pressed && { opacity: 0.6 }]}>
      <Text style={s.time}>
        {clock(f.t)}
        {f.late ? " ☾" : ""}
      </Text>
      <Text style={[s.side, { color: f.side === "buy" ? UP : DOWN }]}>{f.side === "buy" ? "BUY" : "SELL"}</Text>
      <Text style={s.what}>
        {amount(f.amount)} {symbol}
      </Text>
      <Text style={s.usd}>{f.usd !== null ? money(f.usd) : "–"}</Text>
      <Text style={[s.pnl, { color: f.pnl === null ? color.faint : toneColor(toneOf(f.pnl)) }]}>{f.pnl !== null ? signed(f.pnl) : ""}</Text>
    </Pressable>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.s }}>
      <Text style={{ width: 52, fontSize: 12.5, color: color.faint, paddingTop: 1 }}>{k}</Text>
      <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 18, color: color.text }}>{v}</Text>
    </View>
  );
}

function Fig({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={type.small}>{label}</Text>
      <Text style={[s.fig, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.m, paddingBottom: space.xxl },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  figs: { flexDirection: "row", gap: space.s, paddingBottom: space.xs },
  fig: { fontSize: 19, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"] },
  join: { fontSize: 13.5, lineHeight: 18, color: TONE_COLOR.watch, fontWeight: "600" },
  coinRow: { flexDirection: "row", alignItems: "baseline", paddingVertical: 4 },
  coin: { flex: 1, fontSize: 14.5, fontWeight: "600", color: color.text },
  cell: { width: 76, textAlign: "right", fontSize: 14, color: color.text, fontVariant: ["tabular-nums"] },
  day: { gap: 2, paddingTop: space.s },
  dayHead: { flexDirection: "row", alignItems: "center", gap: space.m, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  dayName: { fontSize: 14.5, fontWeight: "700", color: color.text, width: 96 },
  state: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  quiet: { fontSize: 13, color: color.faint, paddingVertical: 4 },
  trade: { flexDirection: "row", alignItems: "baseline", paddingVertical: 5, gap: space.s },
  time: { width: 56, fontSize: 12.5, color: color.muted, fontVariant: ["tabular-nums"] },
  side: { width: 36, fontSize: 12, fontWeight: "700" },
  what: { flex: 1, fontSize: 13.5, color: color.text },
  usd: { width: 64, textAlign: "right", fontSize: 13.5, color: color.text, fontVariant: ["tabular-nums"] },
  pnl: { width: 60, textAlign: "right", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  caption: { fontSize: 12.5, lineHeight: 17, color: color.faint },
});
