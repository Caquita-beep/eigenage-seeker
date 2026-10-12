import Constants from "expo-constants";
import { Stack } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, space, type } from "../theme";

/**
 * About the app and who makes it: what it is, where its data stays, where it
 * comes from, and how to reach the developer. Linked from the foot of Today.
 */

const SITE = "https://eigenage.org";
const SUPPORT = "support@eigenage.org";
const DEVELOPER = "EigenAge";

const SOURCES = [
  "Body: a Bluetooth chest strap's beats, read by this phone, with no company's cloud in between",
  "Wallet: your signed Solana transactions, read from a Solana RPC",
  "Market: Binance (SOL and BTC), Deribit (DVOL and SOL options), GeckoTerminal and DEX Screener (coins), alternative.me (Fear & Greed)",
];

export default function About() {
  const version = Constants.expoConfig?.version ?? "–";
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "About" }} />
      <View style={{ gap: 6 }}>
        <Text style={s.name}>Heart Alpha</Text>
        <Text style={type.small}>Version {version} · by EigenAge · for the Solana Seeker</Text>
        <Text style={s.lede}>Read your trading the way an athlete reads their training.</Text>
      </View>

      <View style={s.card}>
        <Row k="What it does" first>
          Puts three things side by side that a trader rarely sees together: what your body did overnight, what the market is doing, and what your
          wallet actually did. Each morning it reads them into one assessment, and over time it shows what your state did to your trading and its P&amp;L.
        </Row>
        <Row k="Your data">Everything is computed on this phone. Health data, wallet history and results never leave it. The wallet is connected read-only.</Row>
        <Row k="Not advice">
          A tool for reading yourself, not medical or financial advice. For anything about your health, see a doctor; every trade is your own decision.
        </Row>
        <Row k="Data from">{SOURCES.join(". ")}.</Row>
        <Row k="Built for">CLOCK IN, the Solana Mobile hackathon.</Row>
      </View>

      <View style={s.card}>
        <Row k="Developer" first>
          {DEVELOPER}
        </Row>
        <Link k="Website" label="eigenage.org" onPress={() => Linking.openURL(SITE)} />
        <Link k="Contact" label={SUPPORT} onPress={() => Linking.openURL(`mailto:${SUPPORT}`)} />
      </View>
    </ScrollView>
  );
}

function Row({ k, children, first }: { k: string; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={[s.row, !first && s.divider]}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{children}</Text>
    </View>
  );
}

function Link({ k, label, onPress }: { k: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, s.divider, pressed && { opacity: 0.6 }]}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, { color: color.body, fontWeight: "600" }]}>{label} ›</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl },
  name: { fontSize: 30, fontWeight: "700", color: color.text, letterSpacing: -0.5 },
  lede: { fontSize: 16, color: color.muted, lineHeight: 22 },
  card: { backgroundColor: color.surface, borderRadius: 16, paddingHorizontal: space.l, paddingVertical: space.s, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { paddingVertical: space.m, gap: 3 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  k: { ...type.label },
  v: { fontSize: 14.5, lineHeight: 20, color: color.text },
});
