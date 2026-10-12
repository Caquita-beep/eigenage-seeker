import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedProps, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from "react-native-svg";
import { cycleMs, phaseAt, shapePath, type Pattern } from "./breath";
import { color } from "./theme";

/**
 * The breathing guide, in three looks, one clock.
 *
 *   Hexagon   the mark's shape. A still, faint hexagon is the dial: a point
 *             of light goes round it once a breath, ticks where each phase
 *             begins. Inside, three hexagons open out as the lungs fill and
 *             fold in as they empty, turning a sixth of a turn a breath (the
 *             hexagon's symmetry, so the turn never jumps).
 *   Orb       a glowing sphere that swells and settles, rings spreading from
 *             it as it fills; the light goes round a circle.
 *   Wave      the breath as a line drawn across the screen, the past in
 *             colour behind a fixed point, the next breath dim ahead of it:
 *             what is coming is in sight, the way a chart reads.
 *
 * Everything moves on the UI thread from one clock (`useFrameCallback`), so
 * it stays smooth while the strap's beats are read on the JS thread; only
 * the words, the phase and the seconds left, come from there. The ease
 * between levels is a half cosine: a breath starts and ends slowly.
 */

export type Look = "hexagon" | "orb" | "wave";
export const LOOKS: { key: Look; label: string }[] = [
  { key: "hexagon", label: "Hexagon" },
  { key: "orb", label: "Orb" },
  { key: "wave", label: "Wave" },
];

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The point of light and the dots trailing it. */
const TAIL = 7;
const TAIL_STEP = 0.0045;

/** At `t` ms: how full, 0–1; how far through the cycle; and how many cycles before it. */
function breathAt(t: number, ds: number[], tos: number[]): { p: number; u: number; n: number } {
  "worklet";
  let total = 0;
  for (let i = 0; i < ds.length; i++) total += ds[i];
  const n = Math.floor(t / total);
  let r = t - n * total;
  const u = r / total;
  let prev = tos[tos.length - 1];
  for (let i = 0; i < ds.length; i++) {
    if (r < ds[i]) {
      const e = 0.5 - 0.5 * Math.cos(Math.PI * (r / ds[i]));
      return { p: prev + (tos[i] - prev) * e, u, n };
    }
    prev = tos[i];
    r -= ds[i];
  }
  return { p: tos[tos.length - 1], u, n };
}

/** Room around the mark's line for its point. */
const MARK_PAD = 3;

/**
 * A pattern's breath as a small line, with a point riding it at the pattern's own pace: its mark on a card
 * (`app/(tabs)/index.tsx`). `still` stops the clock, for a screen out of sight.
 */
export function BreathMark({ pattern, tint, still = false, width = 52, height = 24 }: { pattern: Pattern; tint: string; still?: boolean; width?: number; height?: number }) {
  const ds = useMemo(() => pattern.phases.map((x) => x.s * 1000), [pattern]);
  const tos = useMemo(() => pattern.phases.map((x) => x.to), [pattern]);
  const d = useMemo(() => shapePath(pattern, width, height, MARK_PAD), [pattern, width, height]);
  const t = useSharedValue(0);
  const origin = useSharedValue(-1);
  const frame = useFrameCallback((f) => {
    if (origin.get() < 0) origin.set(f.timestamp - t.get());
    t.set(f.timestamp - origin.get());
  }, !still);
  useEffect(() => {
    // Picks up where it stopped.
    origin.set(-1);
    frame.setActive(!still);
  }, [still, frame, origin]);
  const dot = useAnimatedProps(() => {
    const b = breathAt(t.get(), ds, tos);
    return { cx: MARK_PAD + b.u * width, cy: height - MARK_PAD - b.p * (height - 2 * MARK_PAD) };
  });
  return (
    <Svg width={width + 2 * MARK_PAD} height={height}>
      <Path d={d} transform={`translate(${MARK_PAD},0)`} stroke={tint} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
      <AnimatedCircle animatedProps={dot} r={2.8} fill={tint} />
    </Svg>
  );
}

/** Where each phase begins, as a fraction of the cycle. */
const starts = (p: Pattern) => p.phases.map((_, i) => p.phases.slice(0, i).reduce((at, x) => at + x.s * 1000, 0) / cycleMs(p));

interface LookProps {
  t: SharedValue<number>;
  ds: number[];
  tos: number[];
  total: number;
  size: number;
  pattern: Pattern;
}

/**
 * `epoch` restarts the cycle, on its first breath in, whenever it changes: the Breathe screen bumps it with each
 * new pattern.
 */
export function Breather({ pattern, size = 240, epoch = 0, look = "hexagon" }: { pattern: Pattern; size?: number; epoch?: number; look?: Look }) {
  const ds = useMemo(() => pattern.phases.map((x) => x.s * 1000), [pattern]);
  const tos = useMemo(() => pattern.phases.map((x) => x.to), [pattern]);
  const total = cycleMs(pattern);

  const t = useSharedValue(0);
  const origin = useSharedValue(-1);
  useEffect(() => {
    origin.set(-1);
  }, [epoch, pattern, origin]);
  useFrameCallback((f) => {
    if (origin.get() < 0) origin.set(f.timestamp);
    t.set(f.timestamp - origin.get());
  });

  // The words, from the JS thread, ten times a second.
  const [now, setNow] = useState(() => phaseAt(pattern, 0));
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setNow(phaseAt(pattern, Date.now() - start)), 100);
    return () => clearInterval(id);
  }, [pattern, epoch]);

  const props: LookProps = { t, ds, tos, total, size, pattern };
  return (
    <View style={{ width: size, height: size, alignSelf: "center" }}>
      {look === "orb" ? <Orb {...props} /> : look === "wave" ? <Wave {...props} /> : <Hexagon {...props} />}
      <View style={[StyleSheet.absoluteFill, s.centre, look === "wave" && s.top]} pointerEvents="none">
        <Text style={s.phase}>{now.phase.label}</Text>
        <Text style={[s.count, { fontSize: Math.round(size * 0.15) }]}>{Math.max(1, Math.ceil(now.left))}</Text>
      </View>
    </View>
  );
}

/* ── Hexagon ─────────────────────────────────────────────────────────────── */

/** The breath's hexagon, empty and full, against the track's 1: room in the middle for the words when empty. */
const R_EMPTY = 0.48;
const R_FULL = 0.8;

function hexPath(r: number, rot: number): string {
  "worklet";
  let d = "";
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * k + rot) * Math.PI) / 180;
    d += `${k ? "L" : "M"}${(r * Math.cos(a)).toFixed(4)} ${(r * Math.sin(a)).toFixed(4)}`;
  }
  return `${d}Z`;
}

/** The point `u` of the way round the hexagon track, clockwise from the top. */
function onHex(u: number): { x: number; y: number } {
  "worklet";
  const s = (((u % 1) + 1) % 1) * 6;
  const k = Math.floor(s);
  const f = s - k;
  const a0 = ((-90 + 60 * k) * Math.PI) / 180;
  const a1 = ((-90 + 60 * (k + 1)) * Math.PI) / 180;
  return { x: Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f, y: Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f };
}

/** The point `u` of the way round the circle track, clockwise from the top. */
function onCircle(u: number): { x: number; y: number } {
  "worklet";
  const a = 2 * Math.PI * u - Math.PI / 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

function Hexagon({ t, ds, tos, total, size, pattern }: LookProps) {
  const px = (n: number) => (n * 2.24) / size;
  const glow = useAnimatedProps(() => {
    const b = breathAt(t.get(), ds, tos);
    return { d: hexPath(R_EMPTY + (R_FULL - R_EMPTY) * b.p, (b.n + b.u) * 60), strokeOpacity: 0.05 + 0.12 * b.p };
  });
  const outer = useAnimatedProps(() => {
    const b = breathAt(t.get(), ds, tos);
    return { d: hexPath(R_EMPTY + (R_FULL - R_EMPTY) * b.p, (b.n + b.u) * 60) };
  });
  const middle = useAnimatedProps(() => {
    const b = breathAt(t.get(), ds, tos);
    const r = (R_EMPTY + (R_FULL - R_EMPTY) * b.p) * (1 - (0.07 + 0.13 * b.p));
    return { d: hexPath(r, -(b.n + b.u) * 30) };
  });
  const inner = useAnimatedProps(() => {
    const b = breathAt(t.get(), ds, tos);
    const r = (R_EMPTY + (R_FULL - R_EMPTY) * b.p) * (1 - 2 * (0.07 + 0.13 * b.p));
    return { d: hexPath(r, (b.n + b.u) * 15), fillOpacity: 0.03 + 0.1 * b.p };
  });
  const ticks = useMemo(() => starts(pattern).map((u) => onHex(u)), [pattern]);

  return (
    <Svg width={size} height={size} viewBox="-1.12 -1.12 2.24 2.24">
      <Path d={hexPath(1, 0)} fill="none" stroke={color.line} strokeWidth={px(1.2)} strokeLinejoin="round" />
      {ticks.map((q, i) => (
        <Circle key={i} cx={q.x} cy={q.y} r={px(2.4)} fill={color.muted} />
      ))}
      <AnimatedPath fill="none" stroke={color.body} strokeWidth={px(10)} strokeLinejoin="round" animatedProps={glow} />
      <AnimatedPath fill="none" stroke={color.body} strokeWidth={px(1.6)} strokeLinejoin="round" animatedProps={outer} />
      <AnimatedPath fill="none" stroke={color.body} strokeOpacity={0.5} strokeWidth={px(1.2)} strokeLinejoin="round" animatedProps={middle} />
      <AnimatedPath fill={color.body} stroke={color.body} strokeOpacity={0.3} strokeWidth={px(1)} strokeLinejoin="round" animatedProps={inner} />
      <Light t={t} total={total} size={size} at={onHex} />
    </Svg>
  );
}

/* ── Orb ─────────────────────────────────────────────────────────────────── */

const ORB_EMPTY = 0.34;
const ORB_FULL = 0.7;

function Orb({ t, ds, tos, total, size, pattern }: LookProps) {
  const px = (n: number) => (n * 2.24) / size;
  const radius = (p: number) => {
    "worklet";
    return ORB_EMPTY + (ORB_FULL - ORB_EMPTY) * p;
  };
  const halo = useAnimatedProps(() => ({ r: radius(breathAt(t.get(), ds, tos).p) * 1.28 }));
  const rim = useAnimatedProps(() => ({ r: radius(breathAt(t.get(), ds, tos).p) }));
  const ring1 = useAnimatedProps(() => {
    const p = breathAt(t.get(), ds, tos).p;
    return { r: radius(p) * (1 + 0.1 * p), strokeOpacity: 0.32 * p };
  });
  const ring2 = useAnimatedProps(() => {
    const p = breathAt(t.get(), ds, tos).p;
    return { r: radius(p) * (1 + 0.2 * p), strokeOpacity: 0.16 * p };
  });
  const ticks = useMemo(() => starts(pattern).map((u) => onCircle(u)), [pattern]);

  return (
    <Svg width={size} height={size} viewBox="-1.12 -1.12 2.24 2.24">
      <Defs>
        <RadialGradient id="orb" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color.body} stopOpacity={0.42} />
          <Stop offset="0.62" stopColor={color.body} stopOpacity={0.14} />
          <Stop offset="1" stopColor={color.body} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle r={1} fill="none" stroke={color.line} strokeWidth={px(1.2)} />
      {ticks.map((q, i) => (
        <Circle key={i} cx={q.x} cy={q.y} r={px(2.4)} fill={color.muted} />
      ))}
      <AnimatedCircle fill="url(#orb)" animatedProps={halo} />
      <AnimatedCircle fill="none" stroke={color.body} strokeWidth={px(1)} animatedProps={ring2} />
      <AnimatedCircle fill="none" stroke={color.body} strokeWidth={px(1)} animatedProps={ring1} />
      <AnimatedCircle fill="none" stroke={color.body} strokeWidth={px(1.6)} animatedProps={rim} />
      <Light t={t} total={total} size={size} at={onCircle} />
    </Svg>
  );
}

/* ── Wave ────────────────────────────────────────────────────────────────── */

/** In a 100 by 100 box: the fixed point "now", and the band the breath moves in, empty at its foot. */
const NOW_X = 36;
const WAVE_FULL = 46;
const WAVE_EMPTY = 86;
const SAMPLES = 36;

function Wave({ t, ds, tos, total, size }: LookProps) {
  // A breath and a half across the box, so the next one is always in sight; never squeezed under 12 s.
  const span = Math.max(total * 1.5, 12_000);
  const y = (p: number) => {
    "worklet";
    return WAVE_EMPTY - (WAVE_EMPTY - WAVE_FULL) * p;
  };
  const line = (from: number, to: number) => {
    "worklet";
    const now = t.get();
    let d = "";
    for (let i = 0; i <= SAMPLES; i++) {
      const x = from + ((to - from) * i) / SAMPLES;
      const p = breathAt(now + ((x - NOW_X) / 100) * span, ds, tos).p;
      d += `${i ? "L" : "M"}${x.toFixed(2)},${y(p).toFixed(2)}`;
    }
    return d;
  };
  const past = useAnimatedProps(() => ({ d: line(0, NOW_X) }));
  const ahead = useAnimatedProps(() => ({ d: line(NOW_X, 100) }));
  const dot = useAnimatedProps(() => ({ cy: y(breathAt(t.get(), ds, tos).p) }));
  const k = 100 / size;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Line x1={0} x2={100} y1={WAVE_FULL} y2={WAVE_FULL} stroke={color.line} strokeWidth={k} strokeDasharray={[2 * k, 3 * k]} />
      <Line x1={0} x2={100} y1={WAVE_EMPTY} y2={WAVE_EMPTY} stroke={color.line} strokeWidth={k} strokeDasharray={[2 * k, 3 * k]} />
      <Line x1={NOW_X} x2={NOW_X} y1={WAVE_FULL - 8} y2={WAVE_EMPTY + 8} stroke={color.line} strokeWidth={k} />
      <AnimatedPath fill="none" stroke={color.body} strokeWidth={8 * k} strokeOpacity={0.1} strokeLinecap="round" animatedProps={past} />
      <AnimatedPath fill="none" stroke={color.body} strokeWidth={2 * k} strokeLinecap="round" strokeLinejoin="round" animatedProps={past} />
      <AnimatedPath fill="none" stroke={color.muted} strokeOpacity={0.45} strokeWidth={1.4 * k} strokeLinecap="round" strokeLinejoin="round" animatedProps={ahead} />
      <AnimatedCircle cx={NOW_X} r={10 * k} fill={color.body} opacity={0.18} animatedProps={dot} />
      <AnimatedCircle cx={NOW_X} r={4 * k} fill={color.text} animatedProps={dot} />
    </Svg>
  );
}

/* ── The point of light ──────────────────────────────────────────────────── */

/** The light going round a track once a breath, with its trail and halo; `at` places it on the track. */
function Light({ t, total, size, at }: { t: SharedValue<number>; total: number; size: number; at: (u: number) => { x: number; y: number } }) {
  const px = (n: number) => (n * 2.24) / size;
  return (
    <>
      {Array.from({ length: TAIL }, (_, j) => TAIL - 1 - j).map((j) => (
        <Dot key={j} t={t} total={total} j={j} r={j === 0 ? px(3.6) : px(2.8) * (1 - j / TAIL)} at={at} />
      ))}
      <Dot t={t} total={total} j={0} r={px(9)} at={at} halo />
    </>
  );
}

function Dot({ t, total, j, r, at, halo }: { t: SharedValue<number>; total: number; j: number; r: number; at: (u: number) => { x: number; y: number }; halo?: boolean }) {
  const props = useAnimatedProps(() => {
    const q = at(t.get() / total - j * TAIL_STEP);
    return { cx: q.x, cy: q.y };
  });
  return (
    <AnimatedCircle
      r={r}
      fill={halo ? color.body : j === 0 ? color.text : color.body}
      opacity={halo ? 0.18 : j === 0 ? 1 : 0.6 * (1 - j / TAIL)}
      animatedProps={props}
    />
  );
}

const s = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center", gap: 2 },
  top: { justifyContent: "flex-start", paddingTop: "6%" },
  phase: { fontSize: 11, fontWeight: "600", letterSpacing: 3, color: color.muted, textTransform: "uppercase" },
  count: { fontWeight: "200", color: color.text, fontVariant: ["tabular-nums"] },
});
