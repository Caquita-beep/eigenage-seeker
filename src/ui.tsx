import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { color, space, type } from "./theme";

export function Card({ label, accent, children }: { label: string; accent?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        {accent ? <View style={[s.dot, { backgroundColor: accent }]} /> : null}
        <Text style={type.label}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

export function Stat({ label, value, note, tint }: { label: string; value: string; note?: string; tint?: string }) {
  return (
    <View style={s.stat}>
      <Text style={type.small}>{label}</Text>
      <Text style={[type.value, tint ? { color: tint } : null]}>{value}</Text>
      {note ? <Text style={[type.small, { color: color.faint }]}>{note}</Text> : null}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export const positionColor = { below: color.below, within: color.within, above: color.above } as const;

/** A tiny line of the recent past, for a list row. No axes; the shape is the point. */
export function Sparkline({ values, tint, width = 72, height = 30 }: { values: number[]; tint: string; width?: number; height?: number }) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return <View style={{ width, height }} />;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo || 1;
  const d = xs.map((v, i) => `${i ? "L" : "M"}${((i / (xs.length - 1)) * width).toFixed(1)},${(2 + (1 - (v - lo) / span) * (height - 4)).toFixed(1)}`).join("");
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={tint} strokeWidth={1.4} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

/** A small coloured label: a change, or where a value sits against its normal. */
export function Pill({ text, tint }: { text: string; tint: string }) {
  return (
    <View style={[s.pill, { backgroundColor: tint }]}>
      <Text style={s.pillText}>{text}</Text>
    </View>
  );
}

/**
 * One row of the dashboard, in the shape of a markets list: what it is on the
 * left, its recent shape in the middle, the number and its state on the right.
 * Tapping opens the full chart.
 */
export function ListRow({
  title,
  subtitle,
  spark,
  tint,
  value,
  pill,
  onPress,
}: {
  title: string;
  subtitle: string;
  spark?: number[];
  tint: string;
  value: string;
  pill?: { text: string; tint: string };
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} android_ripple={{ color: color.raised }} style={({ pressed }) => [s.listRow, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.listTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {spark ? <Sparkline values={spark} tint={tint} /> : null}
      <View style={s.listRight}>
        <Text style={s.listValue}>{value}</Text>
        {pill ? <Pill {...pill} /> : null}
      </View>
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text style={[type.label, { paddingHorizontal: space.l, paddingBottom: space.s }]}>{title}</Text>
      <View style={s.section}>{children}</View>
    </View>
  );
}

/**
 * A score ring, 0–100, filled clockwise from the top, the number in the
 * middle and what it is underneath. With no score, an empty ring and a dash.
 */
export function Ring({ pct, tint, label, sub, size = 104, unit = "%" }: { pct: number | null; tint: string; label: string; sub?: string; size?: number; unit?: string }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct === null ? 0 : Math.max(0.01, Math.min(1, pct / 100)) * c;
  return (
    <View style={s.ring}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.raised} strokeWidth={stroke} fill="none" />
          {pct !== null ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={tint}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${filled} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null}
        </Svg>
        <Text style={[s.ringValue, { color: pct === null ? color.faint : color.text }]}>{pct === null ? "–" : `${pct}${unit}`}</Text>
      </View>
      <Text style={s.ringLabel}>{label}</Text>
      {sub ? <Text style={s.ringSub}>{sub}</Text> : null}
    </View>
  );
}

/** The resolution picker over a chart: Hourly, Daily, Weekly — whichever the data has. */
export function ResToggle<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={s.res}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.resBtn, value === o.key && s.resOn]}>
          <Text style={[s.resText, value === o.key && { color: color.text }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Fear & Greed as a half dial: 0 extreme fear on the left, 100 extreme greed on the right. */
export function Dial({ value, size = 180 }: { value: number; size?: number }) {
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const at = (v: number) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number) => {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };
  const [nx, ny] = at(value);
  const tint = value < 25 ? color.below : value < 45 ? "#E5A06B" : value <= 55 ? color.muted : value <= 75 ? "#9CCB6B" : color.body;
  return (
    <Svg width={size} height={size / 2 + 12}>
      <Path d={arc(0, 100)} stroke={color.line} strokeWidth={10} fill="none" strokeLinecap="round" />
      <Path d={arc(0, Math.max(value, 0.5))} stroke={tint} strokeWidth={10} fill="none" strokeLinecap="round" />
      <Circle cx={nx} cy={ny} r={7} fill={color.bg} stroke={tint} strokeWidth={3} />
    </Svg>
  );
}

/**
 * The night as a clock face, 18:00 at the top and running round to 05:00.
 * Each tick is one signed transaction. Midnight to five, where being awake is
 * the exposure, is shaded.
 */
export function NightClock({ minutes, size = 200 }: { minutes: number[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;
  const SPAN = 24 * 60;
  const pt = (m: number, rr: number) => {
    const a = (m / SPAN) * 2 * Math.PI - Math.PI / 2;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const;
  };
  const [ax, ay] = pt(360, r);
  const [bx, by] = pt(660, r);
  const shade = `M${cx},${cy} L${ax},${ay} A${r},${r} 0 0 1 ${bx},${by} Z`;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke={color.line} strokeWidth={1} fill="none" />
      <Path d={shade} fill={color.wallet} opacity={0.1} />
      {[0, 360, 720, 1080].map((m) => {
        const [x1, y1] = pt(m, r - 6);
        const [x2, y2] = pt(m, r);
        return <Line key={m} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color.faint} strokeWidth={2} />;
      })}
      {minutes.map((m, i) => {
        const mm = ((m % SPAN) + SPAN) % SPAN;
        const [x1, y1] = pt(mm, r - 22);
        const [x2, y2] = pt(mm, r - 2);
        return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color.wallet} strokeWidth={1.5} opacity={0.7} />;
      })}
    </Svg>
  );
}

/**
 * Where a number came from, next to the number. Each link opens the provider's
 * own page, so the reader can check the figure against its source.
 */
export function Source({ children, links }: { children?: ReactNode; links: { label: string; url: string }[] }) {
  return (
    <Text style={s.source}>
      Source:{" "}
      {links.map((l, i) => (
        <Text key={l.url}>
          {i ? ", " : ""}
          <Text style={s.link} onPress={() => Linking.openURL(l.url)}>
            {l.label}
          </Text>
        </Text>
      ))}
      {children ? <Text>. {children}</Text> : null}
    </Text>
  );
}

export const fmt = {
  usd: (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `$${Math.round(n / 1e3)}k` : `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`,
  pct: (n: number | null, digits = 1) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`),
  vol: (n: number | null) => (n === null ? "–" : n.toFixed(0)),
};

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: space.l,
    gap: space.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stat: { flex: 1, gap: 2 },
  row: { flexDirection: "row", gap: space.l },
  source: { fontSize: 12, lineHeight: 17, color: color.faint },
  res: { flexDirection: "row", gap: space.s, paddingHorizontal: space.l },
  resBtn: { paddingHorizontal: space.m, paddingVertical: 6, borderRadius: 8, backgroundColor: color.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  resOn: { backgroundColor: color.raised, borderColor: color.muted },
  resText: { fontSize: 13.5, fontWeight: "600", color: color.muted },
  ring: { alignItems: "center", gap: 4, flex: 1 },
  ringValue: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  ringLabel: { fontSize: 13, fontWeight: "600", color: color.text, marginTop: 4 },
  ringSub: { fontSize: 11.5, color: color.muted, textAlign: "center" },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, minWidth: 64, alignItems: "center" },
  pillText: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  listTitle: { fontSize: 15.5, fontWeight: "600", color: color.text },
  listRight: { alignItems: "flex-end", gap: 4, minWidth: 76 },
  listValue: { fontSize: 15.5, fontWeight: "600", color: color.text, fontVariant: ["tabular-nums"] },
  link: { color: color.muted, textDecorationLine: "underline" },
});
