import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBody, useWalletData } from "./data";
import { TONE_COLOR } from "./insight";
import { color, space } from "./theme";

/**
 * The first thing a new reader sees: three pages, a few words each, showing
 * the app's own pieces rather than describing them. Shown once — on the
 * first open — over the app, so Today never flashes underneath. It ends in
 * Today, or with synthetic data loaded for anyone without a wearable.
 */

const SEEN = "intro:seen:v1";

export function IntroGate() {
  const [state, setState] = useState<"unknown" | "show" | "hidden">("unknown");
  useEffect(() => {
    AsyncStorage.getItem(SEEN)
      .then((v) => setState(v ? "hidden" : "show"))
      .catch(() => setState("hidden"));
  }, []);
  useEffect(() => {
    if (state !== "show") return;
    // Back on the intro leaves the app, rather than revealing the screen behind it.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => false);
    return () => sub.remove();
  }, [state]);

  const done = () => {
    setState("hidden");
    AsyncStorage.setItem(SEEN, "1").catch(() => {});
  };
  if (state === "hidden") return null;
  if (state === "unknown") return <View style={[StyleSheet.absoluteFill, { backgroundColor: color.bg }]} />;
  return <Intro onDone={done} />;
}

function Intro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  const { loadSynthetic: syntheticBody } = useBody();
  const { loadSynthetic: syntheticWallet } = useWalletData();
  const go = (p: number) => ref.current?.scrollTo({ x: p * width, animated: true });
  const last = page === PAGES - 1;

  return (
    <SafeAreaView style={[StyleSheet.absoluteFill, s.screen]} edges={["top", "bottom"]}>
      <View style={s.top}>
        <Text style={s.brand}>EigenAge</Text>
        {!last ? (
          <Pressable onPress={onDone} hitSlop={12}>
            <Text style={s.skip}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        <Page width={width} title={"Your body, your trades,\nthe market."} line="Joined, on this phone.">
          <Join />
        </Page>
        <Page width={width} title="Each morning, one call." line="From how you slept, how you trade and how the market moves.">
          <View style={[s.mock, { borderColor: TONE_COLOR.good, borderWidth: 1.5 }]}>
            <View style={s.mockHead}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR.good }]} />
              <Text style={[s.mockTitle, { color: TONE_COLOR.good }]}>Trade as planned</Text>
            </View>
            <Text style={s.mockSub}>Usual size</Text>
            <Text style={s.mockStates}>
              Body <Text style={{ color: TONE_COLOR.good, fontWeight: "700" }}>Stable</Text>
              {"   ·   Market "}
              <Text style={{ color: TONE_COLOR.good, fontWeight: "700" }}>Calm</Text>
            </Text>
          </View>
        </Page>
        <Page width={width} title="Learn what moves you." line="Links found in your own history, and only when they are clear.">
          <View style={s.mock}>
            <View style={s.mockHead}>
              <View style={[s.dot, { backgroundColor: TONE_COLOR.watch }]} />
              <Text style={[s.mockTitle, { color: color.text, fontSize: 16, flex: 1 }]}>Your body → your trading</Text>
              <Text style={[s.found, { color: TONE_COLOR.watch }]}>Found</Text>
            </View>
            <Text style={s.mockNums}>
              <Text style={{ color: TONE_COLOR.watch, fontWeight: "700" }}>21%</Text> vs 4% · of wallet swapped a day
            </Text>
          </View>
          <Text style={s.privacy}>Read on this phone. Nothing leaves it.</Text>
        </Page>
      </ScrollView>

      <View style={s.bottom}>
        <View style={s.dots}>
          {Array.from({ length: PAGES }, (_, k) => (
            <View key={k} style={[s.pageDot, k === page && s.pageDotOn]} />
          ))}
        </View>
        {last ? (
          <>
            <Pressable style={({ pressed }) => [s.primary, pressed && { opacity: 0.8 }]} onPress={onDone}>
              <Text style={s.primaryText}>Get started</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.secondary, pressed && { opacity: 0.7 }]}
              onPress={() => {
                syntheticBody();
                syntheticWallet();
                onDone();
              }}
            >
              <Text style={s.secondaryText}>Try with synthetic data</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={({ pressed }) => [s.primary, pressed && { opacity: 0.8 }]} onPress={() => go(page + 1)}>
            <Text style={s.primaryText}>Next</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const PAGES = 3;

function Page({ width, title, line, children }: { width: number; title: string; line: string; children: React.ReactNode }) {
  return (
    <View style={[s.page, { width }]}>
      <View style={s.visual}>{children}</View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.line}>{line}</Text>
    </View>
  );
}

/** Body, Wallet and Market as three circles, joined. */
function Join() {
  const size = 240;
  const pts = [
    { x: size / 2, y: 40, label: "Body", tint: color.body },
    { x: 40, y: size - 50, label: "Wallet", tint: color.wallet },
    { x: size - 40, y: size - 50, label: "Market", tint: color.market },
  ];
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {pts.map((a, i) => {
          const b = pts[(i + 1) % pts.length];
          return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color.line} strokeWidth={2} />;
        })}
        {pts.map((p) => (
          <Circle key={p.label} cx={p.x} cy={p.y} r={26} fill={color.surface} stroke={p.tint} strokeWidth={3} />
        ))}
        <Circle cx={size / 2} cy={size / 2 + 12} r={7} fill={color.text} />
      </Svg>
      {pts.map((p) => (
        <Text key={p.label} style={[s.node, { left: p.x - 40, top: p.y + 30, color: p.tint }]}>
          {p.label}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { backgroundColor: color.bg, zIndex: 100 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.l },
  brand: { fontSize: 18, fontWeight: "700", color: color.text, letterSpacing: 0.5 },
  skip: { fontSize: 15, color: color.muted, fontWeight: "600" },
  page: { flex: 1, paddingHorizontal: space.xl, justifyContent: "center", gap: space.m },
  visual: { alignItems: "center", justifyContent: "center", minHeight: 280, gap: space.m },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700", color: color.text },
  line: { fontSize: 16, lineHeight: 22, color: color.muted },
  node: { position: "absolute", width: 80, textAlign: "center", fontSize: 14, fontWeight: "700" },
  mock: { alignSelf: "stretch", backgroundColor: color.surface, borderRadius: 16, padding: space.l, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  mockHead: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 12, height: 12, borderRadius: 6 },
  mockTitle: { fontSize: 22, fontWeight: "700" },
  mockSub: { fontSize: 15, fontWeight: "600", color: color.text, paddingLeft: 20 },
  mockStates: { fontSize: 14, color: color.muted, paddingLeft: 20, paddingTop: 6 },
  mockNums: { fontSize: 14, color: color.muted, paddingLeft: 20 },
  found: { fontSize: 14, fontWeight: "700" },
  privacy: { fontSize: 13, color: color.faint, paddingTop: space.s },
  bottom: { paddingHorizontal: space.xl, paddingBottom: space.l, gap: space.m },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, paddingBottom: space.s },
  pageDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.raised },
  pageDotOn: { backgroundColor: color.text, width: 20 },
  primary: { backgroundColor: color.text, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: color.bg, fontSize: 16, fontWeight: "700" },
  secondary: { paddingVertical: 10, alignItems: "center" },
  secondaryText: { color: color.muted, fontSize: 15, fontWeight: "600" },
});
