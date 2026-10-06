import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Line as SLine, LinearGradient, Path, Rect, Stop, Text as SText } from "react-native-svg";
import type { Candle } from "./candles";
import { DOWN, UP, type Line, type Values } from "./indicators";
import { usePref } from "./prefs";

/**
 * The full-screen chart, built to read like an exchange chart.
 *
 *   drag            pan back through history
 *   pinch           zoom: fewer, wider candles or more, narrower ones
 *   tap             crosshair on at that point; tap again to clear it
 *   hold            crosshair on, then drag it
 *   drag, crosshair on   move the crosshair
 *
 * One main pane (candles, or the series itself as a line) and any number of
 * indicator panes under it, all sharing one time axis and one crosshair. Each
 * pane's legend shows its values at the crosshair, or each line's newest
 * value in view when there is none.
 */

export interface Pane {
  key: string;
  title?: string;
  height: number;
  lines: Line[];
  bands?: { key: string; low: Values; high: Values; color: string; opacity?: number }[];
  guides?: number[];
  zones?: { from: number; to: number; color: string }[];
  domain?: [number, number];
  format: (v: number) => string;
  /** Trades on this pane's time axis: a buy as ▲ under the bar, a sell as ▼ over it. */
  markers?: Marker[];
  /**
   * Named prices drawn across the pane, such as the reader's average cost:
   * a dashed line with its name, held at the top or bottom edge with an arrow
   * when the view does not reach it, so it is never out of sight.
   */
  levels?: { value: number; label: string; color: string }[];
}

export interface Marker {
  /** Index into the chart's time axis. */
  i: number;
  side: "buy" | "sell";
}

export type TimeKind = "intraday" | "daily" | "weekly";

const AXIS_W = 58;
const LEGEND_H = 18;
const TIME_H = 22;
const GRID = "#1E2329";
const AXIS = "#848E9C";
const LABEL_BG = "#2B3139";
const TEXT = "#EAECEF";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Daily and weekly candles open at 00:00 UTC, so their dates are read in UTC; intraday in local time. */
export function timeLabel(ms: number, kind: TimeKind, full: boolean, long = false) {
  const d = new Date(ms);
  if (kind === "intraday") {
    const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return full ? `${d.getFullYear()}-${md} ${hm}` : `${md} ${hm}`;
  }
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  if (full) return `${y}-${m}-${day}`;
  return long ? `${y}-${m}` : `${m}-${day}`;
}

function domainOf(p: Pane, candles: Candle[] | undefined, a: number, b: number): [number, number] {
  if (p.domain) return p.domain;
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v: number | null | undefined) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  if (candles) for (let i = a; i <= b; i++) (take(candles[i]?.l), take(candles[i]?.h));
  for (const l of p.lines) for (let i = a; i <= b; i++) take(l.values[i]);
  for (const band of p.bands ?? []) for (let i = a; i <= b; i++) (take(band.low[i]), take(band.high[i]));
  for (const g of p.guides ?? []) take(g);
  if (p.lines.some((l) => l.kind === "bars" || l.kind === "area")) (take(0));
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) return [lo - Math.abs(lo) * 0.05 - 1e-9, hi + Math.abs(hi) * 0.05 + 1e-9];
  const pad = (hi - lo) * 0.08;
  return [lo === 0 ? 0 : lo - pad, hi + pad];
}

interface Geo {
  plotW: number;
  barW: number;
  a: number;
  b: number;
  x: (i: number) => number;
}

function PaneSvg({
  pane,
  candles,
  geo,
  width,
  cross,
  crossY,
  last,
  isMain,
  gridXs,
}: {
  pane: Pane;
  candles?: Candle[];
  geo: Geo;
  width: number;
  cross: number | null;
  crossY: number | null;
  last: boolean;
  isMain: boolean;
  gridXs: number[];
}) {
  const { a, b, x, barW, plotW } = geo;
  const h = pane.height;
  const [lo, hi] = domainOf(pane, candles, a, b);
  const top = 6;
  const bottom = 4;
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom);
  const inv = (py: number) => lo + (1 - (py - top) / (h - top - bottom)) * (hi - lo);
  const body = Math.max(1, barW * 0.7);

  const path = (vals: Values, bridge = false) => {
    let d = "";
    let pen = false;
    for (let i = a; i <= b; i++) {
      const v = vals[i];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        if (!bridge) pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const levels = isMain ? [0, 0.25, 0.5, 0.75, 1].map((f) => hi - f * (hi - lo)) : [hi, lo];

  const els: React.ReactNode[] = [];

  // grid
  levels.forEach((v, k) => els.push(<SLine key={`gy${k}`} x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />));
  gridXs.forEach((gx, k) => els.push(<SLine key={`gx${k}`} x1={gx} x2={gx} y1={0} y2={h} stroke={GRID} strokeWidth={1} />));

  for (const z of pane.zones ?? []) {
    const y1 = y(Math.min(z.to, hi));
    const y2 = y(Math.max(z.from, lo));
    if (y2 > y1) els.push(<Rect key={`z${z.from}`} x={0} y={y1} width={plotW} height={y2 - y1} fill={z.color} opacity={0.08} />);
  }

  for (const band of pane.bands ?? []) {
    let run: number[] = [];
    const flush = (k: number) => {
      if (run.length > 1) {
        const d =
          run.map((i, j) => `${j ? "L" : "M"}${x(i).toFixed(1)},${y(band.high[i]!).toFixed(1)}`).join("") +
          [...run].reverse().map((i) => `L${x(i).toFixed(1)},${y(band.low[i]!).toFixed(1)}`).join("") +
          "Z";
        els.push(<Path key={`${band.key}${k}`} d={d} fill={band.color} opacity={band.opacity ?? 0.12} />);
      }
      run = [];
    };
    for (let i = a; i <= b; i++) {
      if (band.low[i] != null && band.high[i] != null) run.push(i);
      else flush(i);
    }
    flush(b + 1);
  }

  for (const g of pane.guides ?? []) {
    els.push(<SLine key={`g${g}`} x1={0} x2={plotW} y1={y(g)} y2={y(g)} stroke={AXIS} strokeDasharray="3,4" strokeWidth={0.8} opacity={0.6} />);
  }

  for (const lv of pane.levels ?? []) {
    const inside = lv.value >= lo && lv.value <= hi;
    const ly = inside ? y(lv.value) : lv.value > hi ? 9 : h - 9;
    const text = `${lv.label} ${pane.format(lv.value)}${inside ? "" : lv.value > hi ? " ↑" : " ↓"}`;
    if (inside) els.push(<SLine key={`lv${lv.label}`} x1={0} x2={plotW} y1={ly} y2={ly} stroke={lv.color} strokeDasharray="6,3" strokeWidth={1.2} />);
    els.push(<Rect key={`lvr${lv.label}`} x={4} y={ly - 8} width={text.length * 5.6 + 10} height={16} rx={3} fill={lv.color} />);
    els.push(
      <SText key={`lvt${lv.label}`} x={9} y={ly + 3.5} fill="#0B0E11" fontSize={10} fontWeight="700">
        {text}
      </SText>,
    );
  }

  if (isMain && candles) {
    for (let i = a; i <= b; i++) {
      const c = candles[i];
      if (!c) continue;
      const col = c.c >= c.o ? UP : DOWN;
      const cx = x(i);
      els.push(<SLine key={`w${i}`} x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />);
      if (barW >= 2.5) {
        const y1 = y(Math.max(c.o, c.c));
        const y2 = y(Math.min(c.o, c.c));
        els.push(<Rect key={`b${i}`} x={cx - body / 2} y={y1} width={body} height={Math.max(1, y2 - y1)} fill={col} />);
      }
    }
  }

  if (pane.markers?.length) {
    // Stacked when several trades share a bar, so none hides another.
    const stack = new Map<string, number>();
    for (const m of pane.markers) {
      if (m.i < a || m.i > b) continue;
      const c = candles?.[m.i];
      const v = c ? (m.side === "buy" ? c.l : c.h) : pane.lines[0]?.values[m.i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const k = `${m.i}${m.side}`;
      const n = stack.get(k) ?? 0;
      stack.set(k, n + 1);
      const cx = x(m.i);
      if (m.side === "buy") {
        const ty = y(v) + 5 + n * 9;
        els.push(<Path key={`m${k}${n}`} d={`M${cx},${ty} L${cx - 5},${ty + 8} L${cx + 5},${ty + 8} Z`} fill={UP} stroke="#0B0E11" strokeWidth={0.8} />);
      } else {
        const ty = y(v) - 5 - n * 9;
        els.push(<Path key={`m${k}${n}`} d={`M${cx},${ty} L${cx - 5},${ty - 8} L${cx + 5},${ty - 8} Z`} fill={DOWN} stroke="#0B0E11" strokeWidth={0.8} />);
      }
    }
  }

  const zeroY = y(Math.max(lo, Math.min(0, hi)));
  for (const l of pane.lines) {
    if (l.kind === "bars") {
      for (let i = a; i <= b; i++) {
        const v = l.values[i];
        if (v === null || v === undefined || !Number.isFinite(v) || v === 0) continue;
        const vy = y(v);
        els.push(
          <Rect
            key={`${l.key}${i}`}
            x={x(i) - body / 2}
            y={Math.min(vy, zeroY)}
            width={body}
            height={Math.max(1, Math.abs(zeroY - vy))}
            fill={l.barColors?.[i] ?? l.color}
            opacity={0.85}
          />,
        );
      }
    } else if (l.kind === "dots") {
      for (let i = a; i <= b; i++) {
        const v = l.values[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) els.push(<Circle key={`${l.key}${i}`} cx={x(i)} cy={y(v)} r={3.2} fill={l.color} />);
      }
    } else {
      const d = path(l.values, l.bridge);
      if (!d) continue;
      if (l.kind === "area") {
        let first = -1;
        let lastI = -1;
        for (let i = a; i <= b; i++) if (l.values[i] != null) (first < 0 && (first = i), (lastI = i));
        const gid = `grad${pane.key}${l.key}`;
        els.push(
          <Defs key={`${gid}d`}>
            <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={l.color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={l.color} stopOpacity={0} />
            </LinearGradient>
          </Defs>,
        );
        els.push(<Path key={`${l.key}a`} d={`${d}L${x(lastI)},${zeroY}L${x(first)},${zeroY}Z`} fill={`url(#${gid})`} />);
      }
      els.push(
        <Path
          key={l.key}
          d={d}
          stroke={l.color}
          strokeWidth={l.width ?? 1.1}
          strokeDasharray={l.dashed ? "4,3" : undefined}
          fill="none"
          strokeLinejoin="round"
        />,
      );
    }
  }

  // right axis
  levels.forEach((v, k) =>
    els.push(
      <SText key={`ly${k}`} x={width - 4} y={Math.min(h - 3, Math.max(10, y(v) + 3.5))} fill={AXIS} fontSize={10} textAnchor="end">
        {pane.format(v)}
      </SText>,
    ),
  );

  // newest value, as a dashed line with its label on the axis
  if (last) {
    let v: number | null = null;
    let col = pane.lines[0]?.color ?? TEXT;
    if (candles?.length) {
      const c = candles[candles.length - 1];
      v = c.c;
      col = c.c >= c.o ? UP : DOWN;
    } else {
      const vals = pane.lines[0]?.values ?? [];
      for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) ((v = vals[i]), (i = -1));
    }
    if (v !== null && v >= lo && v <= hi) {
      const vy = y(v);
      els.push(<SLine key="lastl" x1={0} x2={plotW} y1={vy} y2={vy} stroke={col} strokeDasharray="2,3" strokeWidth={0.8} />);
      els.push(<Rect key="lastr" x={plotW + 2} y={vy - 8} width={AXIS_W - 4} height={16} rx={2} fill={col} />);
      els.push(
        <SText key="lastt" x={width - 4} y={vy + 3.5} fill="#FFFFFF" fontSize={10} fontWeight="600" textAnchor="end">
          {pane.format(v)}
        </SText>,
      );
    }
  }

  // crosshair
  if (cross !== null) {
    els.push(<SLine key="cx" x1={x(cross)} x2={x(cross)} y1={0} y2={h} stroke={AXIS} strokeDasharray="3,3" strokeWidth={0.8} />);
    if (crossY !== null) {
      els.push(<SLine key="cy" x1={0} x2={plotW} y1={crossY} y2={crossY} stroke={AXIS} strokeDasharray="3,3" strokeWidth={0.8} />);
      els.push(<Rect key="cyr" x={plotW + 2} y={crossY - 8} width={AXIS_W - 4} height={16} rx={2} fill={LABEL_BG} />);
      els.push(
        <SText key="cyt" x={width - 4} y={crossY + 3.5} fill={TEXT} fontSize={10} textAnchor="end">
          {pane.format(inv(crossY))}
        </SText>,
      );
    }
  }

  return (
    <Svg width={width} height={h}>
      {els}
    </Svg>
  );
}

/** `floor` is the earliest bar to look back to for a value: `at` itself under the crosshair. */
function Legend({ pane, at, floor }: { pane: Pane; at: number; floor: number }) {
  return (
    <Text style={st.legend} numberOfLines={1}>
      {pane.title ? <Text style={{ color: AXIS }}>{pane.title}  </Text> : null}
      {pane.lines.map((l) => {
        // A nightly series (the body's) has no value yet for today's candle.
        let i = at;
        while (i > floor && !Number.isFinite(l.values[i] ?? NaN)) i--;
        const v = l.values[i];
        return (
          <Text key={l.key} style={{ color: l.color }}>
            {l.label}: {v === null || v === undefined || !Number.isFinite(v) ? "–" : pane.format(v)}
            {"  "}
          </Text>
        );
      })}
    </Text>
  );
}

function Ohlc({ c, prev, kind, format, right }: { c: Candle; prev?: Candle; kind: TimeKind; format: (v: number) => string; right: boolean }) {
  const ref = prev?.c ?? c.o;
  const chg = c.c - ref;
  const col = chg >= 0 ? UP : DOWN;
  const rows: [string, string, string?][] = [
    ["Time", timeLabel(c.t, kind, true)],
    ["Open", format(c.o)],
    ["High", format(c.h)],
    ["Low", format(c.l)],
    ["Close", format(c.c)],
    ["Change", `${chg >= 0 ? "+" : ""}${format(chg)}`, col],
    ["Change%", `${chg >= 0 ? "+" : ""}${((chg / ref) * 100).toFixed(2)}%`, col],
    ["Amplitude", `${(((c.h - c.l) / ref) * 100).toFixed(2)}%`],
    ["Vol", c.v >= 1e6 ? `${(c.v / 1e6).toFixed(2)}M` : c.v >= 1e3 ? `${(c.v / 1e3).toFixed(2)}K` : c.v.toFixed(2)],
  ];
  return (
    <View style={[st.ohlc, right ? { right: AXIS_W + 4 } : { left: 4 }]} pointerEvents="none">
      {rows.map(([k, v, tint]) => (
        <View key={k} style={st.ohlcRow}>
          <Text style={st.ohlcKey}>{k}</Text>
          <Text style={[st.ohlcVal, tint ? { color: tint } : null]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export function ProChart({
  t,
  candles,
  main,
  subs = [],
  time,
  initialCount = 90,
  minCount = 12,
  maxCount,
  presets,
  persist,
  onInteraction,
}: {
  t: number[];
  candles?: Candle[];
  main: Pane;
  subs?: Pane[];
  time: TimeKind;
  initialCount?: number;
  minCount?: number;
  maxCount?: number;
  presets?: { label: string; count: number }[];
  /** Remember the window (a preset or a pinch) under this key; it reopens there, at the latest bar. */
  persist?: string;
  onInteraction?: (active: boolean) => void;
}) {
  const n = t.length;
  const cap = Math.max(minCount, Math.min(n, maxCount ?? (candles ? 300 : n)));
  const [width, setWidth] = useState(0);
  const [countRaw, setCount] = usePref(persist ? `${persist}:window` : null, initialCount);
  const [offsetRaw, setOffset] = useState(0);
  const [cross, setCross] = useState<{ i: number; y: number } | null>(null);

  const count = Math.max(Math.min(minCount, n), Math.min(countRaw, cap));
  const offset = Math.max(0, Math.min(offsetRaw, n - count));
  const b = n - 1 - Math.round(offset);
  const a = Math.max(0, b - count + 1);
  const plotW = Math.max(0, width - AXIS_W);
  const barW = plotW / Math.max(count, 1);
  const geo: Geo = useMemo(() => ({ plotW, barW, a, b, x: (i: number) => (i - a + 0.5) * barW }), [plotW, barW, a, b]);

  const panes = [main, ...subs];
  const blocks = useMemo(() => {
    let yy = 0;
    return panes.map((p) => {
      const top = yy + LEGEND_H;
      yy = top + p.height;
      return { key: p.key, top, bottom: yy };
    });
  }, [panes.map((p) => `${p.key}:${p.height}`).join()]);
  const chartH = (blocks.at(-1)?.bottom ?? 0) + TIME_H;

  const live = useRef({ a, b, barW, count, offset, n, cap, blocks, crossOn: false });
  live.current = { a, b, barW, count, offset, n, cap, blocks, crossOn: cross !== null };

  const pointAt = (px: number, py: number) => {
    const L = live.current;
    const i = Math.max(L.a, Math.min(L.b, L.a + Math.floor(px / Math.max(L.barW, 1e-6))));
    return { i, y: py };
  };

  /*
   * A touch starts "pending": it belongs to nobody yet, and the page can
   * still scroll. It becomes the chart's only when it is clearly sideways
   * (pan), a second finger lands (pinch), or a crosshair is on or turned on
   * by holding. A vertical swipe is left to the scroll view, which takes it
   * over; that is what lets the page below a tall chart be reached.
   */
  const G = useRef({
    mode: "none" as "none" | "pending" | "pan" | "cross" | "pinch",
    claimed: false,
    x0: 0,
    y0: 0,
    t0: 0,
    off0: 0,
    cnt0: 0,
    d0: 0,
    moved: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  });

  const claim = () => {
    const g = G.current;
    if (!g.claimed) {
      g.claimed = true;
      onInteraction?.(true);
    }
  };
  const finish = () => {
    const g = G.current;
    if (g.timer) clearTimeout(g.timer);
    g.mode = "none";
    if (g.claimed) {
      g.claimed = false;
      onInteraction?.(false);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => !G.current.claimed,
      onPanResponderGrant: (e) => {
        const g = G.current;
        const L = live.current;
        g.x0 = e.nativeEvent.locationX;
        g.y0 = e.nativeEvent.locationY;
        g.t0 = Date.now();
        g.moved = false;
        g.off0 = L.offset;
        g.cnt0 = L.count;
        g.mode = L.crossOn ? "cross" : "pending";
        if (g.mode === "cross") claim();
        if (g.timer) clearTimeout(g.timer);
        g.timer = setTimeout(() => {
          if (!g.moved && g.mode === "pending") {
            g.mode = "cross";
            claim();
            setCross(pointAt(g.x0, g.y0));
          }
        }, 350);
      },
      onPanResponderMove: (e, gs) => {
        const g = G.current;
        const L = live.current;
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          const d = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
          if (g.mode !== "pinch") {
            g.mode = "pinch";
            g.d0 = d;
            g.cnt0 = L.count;
            if (g.timer) clearTimeout(g.timer);
            claim();
          } else if (d > 10) {
            setCount(Math.round(Math.max(minCount, Math.min(L.cap, (g.cnt0 * g.d0) / d))));
          }
          g.moved = true;
          return;
        }
        if (g.mode === "pinch") return;
        const ax = Math.abs(gs.dx);
        const ay = Math.abs(gs.dy);
        if (ax > 5 || ay > 5) {
          g.moved = true;
          if (g.timer) clearTimeout(g.timer);
        }
        if (g.mode === "pending" && ax > 8 && ax > ay * 1.2) {
          g.mode = "pan";
          claim();
        }
        if (g.mode === "cross") setCross(pointAt(e.nativeEvent.locationX, e.nativeEvent.locationY));
        else if (g.mode === "pan") setOffset(Math.max(0, Math.min(L.n - L.count, g.off0 + gs.dx / Math.max(L.barW, 1e-6))));
      },
      onPanResponderRelease: () => {
        const g = G.current;
        if (!g.moved && Date.now() - g.t0 < 300 && (g.mode === "pending" || g.mode === "cross")) {
          if (live.current.crossOn) setCross(null);
          else setCross(pointAt(g.x0, g.y0));
        }
        finish();
      },
      onPanResponderTerminate: finish,
    }),
  ).current;

  if (!n) return <View style={{ height: chartH }} />;

  const at = cross ? cross.i : b;
  const span = (t[b] - t[a]) / 86_400_000;
  const long = time !== "intraday" && span > 330;
  const gridXs = [0.2, 0.5, 0.8].map((f) => f * plotW);
  const tickIdx = gridXs.map((gx) => Math.max(a, Math.min(b, a + Math.floor(gx / Math.max(barW, 1e-6)))));
  const crossX = cross ? geo.x(cross.i) : 0;
  const priceFmt = main.format;

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: chartH }} {...responder.panHandlers}>
        {width > 0 ? (
          <View pointerEvents="none">
            {panes.map((p, k) => {
              const blk = blocks[k];
              const cy = cross && cross.y >= blk.top && cross.y <= blk.bottom ? cross.y - blk.top : null;
              return (
                <View key={p.key}>
                  <Legend pane={p} at={at} floor={cross ? at : a} />
                  <PaneSvg
                    pane={p}
                    candles={k === 0 ? candles : undefined}
                    geo={geo}
                    width={width}
                    cross={cross ? cross.i : null}
                    crossY={cy}
                    last={k === 0}
                    isMain={k === 0}
                    gridXs={gridXs}
                  />
                </View>
              );
            })}
            <Svg width={width} height={TIME_H}>
              {tickIdx.map((i, k) => (
                <SText key={k} x={gridXs[k]} y={14} fill={AXIS} fontSize={10} textAnchor="middle">
                  {timeLabel(t[i], time, false, long)}
                </SText>
              ))}
              {cross ? (
                <>
                  <Rect x={Math.max(0, Math.min(plotW - 104, crossX - 52))} y={2} width={104} height={17} rx={2} fill={LABEL_BG} />
                  <SText x={Math.max(52, Math.min(plotW - 52, crossX))} y={14} fill={TEXT} fontSize={10} textAnchor="middle">
                    {timeLabel(t[cross.i], time, true)}
                  </SText>
                </>
              ) : null}
            </Svg>
            {cross && candles?.[cross.i] ? (
              <View style={{ position: "absolute", top: LEGEND_H + 4, left: 0, right: 0 }}>
                <Ohlc c={candles[cross.i]} prev={candles[cross.i - 1]} kind={time} format={priceFmt} right={crossX < plotW / 2} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {presets?.length ? (
        <View style={st.presets}>
          {presets
            .filter((p) => p.count < n || p === presets[presets.length - 1])
            .map((p) => {
              const on = offset === 0 && count === Math.max(Math.min(minCount, n), Math.min(p.count, cap));
              return (
                <Pressable
                  key={p.label}
                  hitSlop={6}
                  onPress={() => {
                    setCount(p.count);
                    setOffset(0);
                    setCross(null);
                  }}
                  style={[st.preset, on && st.presetOn]}
                >
                  <Text style={[st.presetText, on && { color: TEXT }]}>{p.label}</Text>
                </Pressable>
              );
            })}
        </View>
      ) : null}
    </View>
  );
}

/** Exchange-style text tabs. `sep` draws a divider before that item. */
export function Tabs<T extends string>({
  items,
  on,
  onPress,
}: {
  items: { key: T; label: string; sep?: boolean; dim?: boolean }[];
  on: (k: T) => boolean;
  onPress: (k: T) => void;
}) {
  return (
    <View style={st.tabs}>
      {items.map((it) => (
        <View key={it.key} style={st.tabWrap}>
          {it.sep ? <View style={st.sep} /> : null}
          <Pressable onPress={() => onPress(it.key)} hitSlop={4} style={st.tab} disabled={it.dim}>
            <Text style={[st.tabText, on(it.key) && st.tabOn, it.dim && { opacity: 0.35 }]}>{it.label}</Text>
            {on(it.key) ? <View style={st.tabBar} /> : null}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  legend: { height: LEGEND_H, fontSize: 10.5, lineHeight: LEGEND_H, color: AXIS, paddingLeft: 2 },
  ohlc: {
    position: "absolute",
    backgroundColor: "rgba(24,26,32,0.94)",
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 150,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2B3139",
  },
  ohlcRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  ohlcKey: { fontSize: 10.5, color: AXIS, lineHeight: 15 },
  ohlcVal: { fontSize: 10.5, color: TEXT, lineHeight: 15, fontVariant: ["tabular-nums"] },
  presets: { flexDirection: "row", gap: 4, paddingTop: 6 },
  preset: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4 },
  presetOn: { backgroundColor: LABEL_BG },
  presetText: { fontSize: 12, fontWeight: "600", color: AXIS },
  tabs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 2 },
  tabWrap: { flexDirection: "row", alignItems: "center" },
  sep: { width: 1, height: 14, backgroundColor: "#2B3139", marginHorizontal: 6 },
  tab: { paddingHorizontal: 9, paddingVertical: 8, alignItems: "center" },
  tabText: { fontSize: 13, fontWeight: "500", color: AXIS },
  tabOn: { color: TEXT, fontWeight: "600" },
  tabBar: { position: "absolute", bottom: 2, height: 2, width: 14, borderRadius: 1, backgroundColor: "#F0B90B" },
});
