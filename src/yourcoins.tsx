import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { isStable } from "./coins";
import { SOL } from "./engine/wallet";
import { OTHER, SLOTS, type Coins } from "./holdings";
import { DOWN, UP } from "./indicators";
import { color, space, type } from "./theme";
import { Section } from "./ui";

/**
 * The coins in the wallet, each with what it is worth now and, first of all,
 * what it cost: the average cost of what is held (`engine/cost.ts`) against
 * today's price, so a glance says which positions are underwater and by how
 * much. Largest first. Tapping one opens its chart with the reader's own buys
 * and sells marked on it, and the average cost drawn across it. Stablecoins
 * are cash: listed, not charted.
 */
export function YourCoins({ coins: { rows, error }, title = "Your coins" }: { coins: Coins; title?: string }) {
  if (!rows.length) return null;
  return (
    <Section title={title}>
      {rows.map((r) => {
        const stable = isStable(r.mint);
        const ch = r.q?.change24h;
        return (
          <Pressable
            key={r.mint}
            disabled={stable}
            onPress={() => router.push((r.mint === SOL ? "/chart/sol" : `/chart/coin?mint=${r.mint}`) as never)}
            android_ripple={{ color: color.raised }}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          >
            <CoinLogo uri={r.image} symbol={r.symbol} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={s.line}>
                <View style={s.name}>
                  <Text style={s.symbol}>{r.symbol}</Text>
                  <View style={[s.swatch, { backgroundColor: r.tint }]} />
                  {r.share !== null ? <Text style={s.share}>{Math.round(100 * r.share)}%</Text> : null}
                </View>
                <Text style={s.value}>{r.value !== null ? `$${r.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "–"}</Text>
              </View>
              <View style={s.line}>
                <Text style={type.small}>
                  {amount(r.amount)} {stable ? "· cash" : r.q ? `· now $${price(r.q.price)}` : ""}
                </Text>
                {!stable && ch !== null && ch !== undefined ? (
                  <Text style={[s.change, { color: ch >= 0 ? UP : DOWN }]}>
                    {ch >= 0 ? "+" : ""}
                    {ch.toFixed(1)}% 24h
                  </Text>
                ) : null}
              </View>
              {stable ? null : r.avg !== null ? (
                <View style={s.line}>
                  <Text style={s.cost}>
                    Avg cost ${price(r.avg)}
                    {r.covered < 0.95 ? <Text style={s.costNote}> · of {amount(r.covered * r.amount)} bought here</Text> : null}
                  </Text>
                  {r.w ? (
                    <Text style={[s.water, { color: r.w.pct < 0 ? DOWN : UP, backgroundColor: r.w.pct < 0 ? "#3A1D22" : "#17331F" }]}>
                      {r.w.pct < 0 ? "▼" : "▲"} {Math.abs(100 * r.w.pct).toFixed(1)}% · {r.w.gain < 0 ? "−" : "+"}$
                      {Math.abs(r.w.gain).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text style={s.costNote}>Cost unknown</Text>
              )}
            </View>
            {!stable ? <Text style={s.chevron}>›</Text> : <View style={{ width: 12 }} />}
          </Pressable>
        );
      })}
      {error ? <Text style={[type.small, { color: color.faint, padding: space.l }]}>Prices unavailable: {error}</Text> : null}
    </Section>
  );
}

const GAP_PX = 2;

/**
 * The balance inside a ring of what makes it up: each coin's share as an arc
 * in its colour (`holdings.ts`), largest first, clockwise from the top, with a
 * 2px gap of background between neighbours, and the coins too thin to see as
 * one grey Other, last. A plain track until the prices are in. The coin list
 * is its legend: each row carries the same colour and its share.
 */
export function BalanceRing({ coins, size, stroke, children }: { coins: Coins; size: number; stroke: number; children: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const shares = new Map<string, number>();
  if (coins.priced) for (const row of coins.rows) if (row.share) shares.set(row.tint, (shares.get(row.tint) ?? 0) + row.share);
  const arcs = SLOTS.filter((t) => shares.has(t))
    .map((tint) => ({ tint, share: shares.get(tint)! }))
    .sort((a, b) => b.share - a.share);
  if (shares.has(OTHER)) arcs.push({ tint: OTHER, share: shares.get(OTHER)! });
  const gap = arcs.length > 1 ? GAP_PX / r : 0;
  const at = (a: number) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  let start = -Math.PI / 2;
  const paths = arcs.map(({ tint, share }) => {
    const sweep = share * 2 * Math.PI;
    const a0 = start + gap / 2;
    const a1 = start + sweep - gap / 2;
    start += sweep;
    if (a1 <= a0) return null;
    return <Path key={tint} d={`M${at(a0)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}`} stroke={tint} strokeWidth={stroke} fill="none" />;
  });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {arcs.length === 1 ? (
          <Circle cx={c} cy={c} r={r} stroke={arcs[0].tint} strokeWidth={stroke} fill="none" />
        ) : arcs.length ? (
          paths
        ) : (
          <Circle cx={c} cy={c} r={r} stroke={color.line} strokeWidth={stroke} fill="none" />
        )}
      </Svg>
      {children}
    </View>
  );
}

/** The coin's logo, or its first letter while there is none or it fails to load. */
export function CoinLogo({ uri, symbol }: { uri: string | null; symbol: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (uri && failed !== uri) return <Image source={{ uri }} style={s.logo} onError={() => setFailed(uri)} />;
  return (
    <View style={[s.logo, s.logoBlank]}>
      <Text style={s.logoLetter}>{symbol.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const price = (v: number) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(3));
const amount = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 1 ? 2 : 4));

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  logo: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.raised },
  logoBlank: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  logoLetter: { fontSize: 15, fontWeight: "700", color: color.muted },
  symbol: { fontSize: 16, fontWeight: "600", color: color.text },
  name: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  share: { fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.s },
  cost: { fontSize: 14, fontWeight: "700", color: color.text, fontVariant: ["tabular-nums"], flexShrink: 1 },
  costNote: { fontSize: 12, fontWeight: "400", color: color.faint },
  water: { fontSize: 12.5, fontWeight: "700", fontVariant: ["tabular-nums"], paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  value: { fontSize: 16, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chevron: { fontSize: 22, color: color.faint, width: 12 },
});
