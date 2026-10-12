import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path } from "react-native-svg";
import { useBody, useMarket, useWalletData } from "./data";
import { MARK, MARK_ASPECT, MARK_VIEWBOX, STROKES, STROKE_WIDTH } from "./logo";
import { color } from "./theme";

/**
 * The launch: the mark drawn on, one hexagon after another, as a hand would
 * draw it (`logo.ts`), then a slow breath while what the phone has saved —
 * the market, the wallet, the body — comes on screen beneath, so Today opens
 * once, complete. Then the mark lifts away.
 *
 * The system's own launch screen is left blank (app.json), the background
 * only, so the drawing starts from nothing; it is hidden once this is up.
 * Never longer than CAP_MS: anything still coming from the network arrives in
 * place after that. With the system's reduce-motion setting, the mark is
 * shown whole and fades.
 */

SplashScreen.preventAutoHideAsync();
// The system screen is the bare background, as this is: a quick change no one sees.
SplashScreen.setOptions({ duration: 100 });

const CAP_MS = 4000;
/** Each hexagon's line takes this long; the next starts STAGGER_MS after. */
const DRAW_MS = 860;
const STAGGER_MS = 150;
/** After this is on screen: the system screen takes SplashScreen's duration to go. */
const START_MS = 180;
/** Until the last line is drawn: the soonest the mark leaves. */
const INTRO_MS = START_MS + STAGGER_MS * (STROKES.length - 1) + DRAW_MS;
const EXIT_MS = 420;

/** The mark's width, dp. */
const SIZE = 128;
/** The brand's paper, the mark's colour on the website's light ground, here on the dark. */
const INK = "#F3F0E8";

const pen = Easing.bezier(0.65, 0, 0.35, 1);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function SplashGate() {
  const market = useMarket().ready;
  const wallet = useWalletData().ready;
  const body = useBody().ready;
  const ready = market && wallet && body;
  const still = useReducedMotion();
  // Up: on screen, the system screen told to go. Everything starts from then, so none of it is drawn unseen.
  const [up, setUp] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [capped, setCapped] = useState(false);
  const [gone, setGone] = useState(false);
  const leaving = drawn && (ready || capped);

  useEffect(() => {
    const b = setTimeout(() => setCapped(true), CAP_MS);
    return () => clearTimeout(b);
  }, []);
  useEffect(() => {
    if (!up) return;
    const a = setTimeout(() => setDrawn(true), still ? 300 : INTRO_MS);
    return () => clearTimeout(a);
  }, [up, still]);

  // The whole mark: in slightly from afar while drawn, a breath while waiting, up and away to leave.
  const scale = useSharedValue(still ? 1 : 0.92);
  const markOpacity = useSharedValue(1);
  const ground = useSharedValue(1);
  useEffect(() => {
    if (up && !still) scale.set(withTiming(1, { duration: INTRO_MS + 200, easing: Easing.out(Easing.cubic) }));
  }, [up, still, scale]);
  useEffect(() => {
    if (!drawn || leaving || still) return;
    const breath = { duration: 1400, easing: Easing.inOut(Easing.sin) };
    scale.set(withRepeat(withSequence(withTiming(1.035, breath), withTiming(1, breath)), -1));
  }, [drawn, leaving, still, scale]);
  useEffect(() => {
    if (!leaving) return;
    cancelAnimation(scale);
    if (!still) scale.set(withTiming(1.12, { duration: EXIT_MS - 100, easing: Easing.in(Easing.cubic) }));
    markOpacity.set(withTiming(0, { duration: EXIT_MS - 120, easing: Easing.in(Easing.quad) }));
    ground.set(withDelay(100, withTiming(0, { duration: EXIT_MS - 100, easing: Easing.out(Easing.quad) })));
    const t = setTimeout(() => setGone(true), EXIT_MS + 40);
    return () => clearTimeout(t);
  }, [leaving, still, scale, markOpacity, ground]);

  const groundStyle = useAnimatedStyle(() => ({ opacity: ground.get() }));
  const markStyle = useAnimatedStyle(() => ({ opacity: markOpacity.get(), transform: [{ scale: scale.get() }] }));

  if (gone) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.ground, groundStyle]}
      pointerEvents={leaving ? "none" : "auto"}
      onLayout={() => {
        SplashScreen.hide();
        setUp(true);
      }}
    >
      <Animated.View style={markStyle}>
        <Svg width={SIZE} height={SIZE * MARK_ASPECT} viewBox={MARK_VIEWBOX}>
          <Defs>
            <ClipPath id="mark">
              <Path d={MARK} />
            </ClipPath>
          </Defs>
          <Ghost go={up} still={still} />
          <G clipPath="url(#mark)">
            {STROKES.map((x, i) => (
              <Stroke key={i} d={x.d} length={x.length} delay={START_MS + i * STAGGER_MS} go={up} still={still} />
            ))}
          </G>
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

/** The mark faintly, first, so the lines are drawn over where they will be. */
function Ghost({ go, still }: { go: boolean; still: boolean }) {
  const o = useSharedValue(0);
  useEffect(() => {
    if (go && !still) o.set(withDelay(START_MS, withTiming(0.07, { duration: 300 })));
  }, [go, still, o]);
  const props = useAnimatedProps(() => ({ fillOpacity: o.get() }));
  return <AnimatedPath d={MARK} fill={INK} animatedProps={props} />;
}

/**
 * One hexagon's centre line, drawn on: a dash its own length, moved in from before its start. The round cap
 * goes ahead of the dash end, so the dash starts a cap's width further back, where nothing shows.
 */
function Stroke({ d, length, delay, go, still }: { d: string; length: number; delay: number; go: boolean; still: boolean }) {
  const p = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (go && !still) p.set(withDelay(delay, withTiming(1, { duration: DRAW_MS, easing: pen })));
  }, [go, still, delay, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: (length + STROKE_WIDTH) * (1 - p.get()) }));
  return (
    <AnimatedPath
      d={d}
      fill="none"
      stroke={INK}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={[length, length + 2 * STROKE_WIDTH]}
      animatedProps={props}
    />
  );
}

const s = StyleSheet.create({
  ground: { backgroundColor: color.bg, alignItems: "center", justifyContent: "center", zIndex: 100, elevation: 100 },
});
