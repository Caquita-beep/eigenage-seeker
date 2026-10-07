import { createSolanaMainnet, MobileWalletProvider } from "@wallet-ui/react-native-kit";
import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { BodyProvider, ExposureProvider, MarketProvider, WalletDataProvider } from "../data";
import { IntroGate } from "../intro";
import { loadPrefs } from "../prefs";
import { SplashGate } from "../splash";
import { color } from "../theme";

const cluster = createSolanaMainnet({
  url: process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
});

// Shown by the wallet when it asks the reader to approve the connection.
const identity = {
  name: "EigenAge",
  uri: "https://eigenage.org",
  icon: "icons/icon-192.png",
};

/** A screen opened straight from a link still has the tabs under it, so Back always has somewhere to go. */
export const unstable_settings = { anchor: "(tabs)" };

// Read the charts' remembered settings now, so they are in memory before any chart opens.
loadPrefs();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.bg, card: color.bg, text: color.text, border: color.line },
};

export default function Root() {
  return (
    <MobileWalletProvider cluster={cluster} identity={identity}>
      <MarketProvider>
        <WalletDataProvider>
          <BodyProvider>
          <ExposureProvider>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: color.bg },
                headerTintColor: color.text,
                headerTitleStyle: { fontSize: 17, fontWeight: "600" },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: color.bg },
                animation: "slide_from_right",
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              {/*
               * One copy of each screen. A chart can take a moment to open, and a
               * second tap meanwhile would push a second copy, then a third, so
               * Back would land on the same chart again and again. With an id, a
               * repeated push brings the open copy forward instead.
               */}
              <Stack.Screen name="chart/[id]" options={{ title: "" }} getId={({ params }) => `${params?.id}:${params?.mint ?? ""}:${params?.sub ?? ""}`} />
              <Stack.Screen name="link/[id]" options={{ title: "" }} getId={({ params }) => `link:${params?.id}`} />
              <Stack.Screen name="period" options={{ title: "" }} getId={({ params }) => `period:${params?.kind}:${params?.start}`} />
              <Stack.Screen name="journal" options={{ title: "Journal" }} getId={() => "journal"} />
              <Stack.Screen name="recap" options={{ title: "Daily recap" }} getId={() => "recap"} />
              <Stack.Screen name="assessment" options={{ title: "How it's read" }} getId={() => "assessment"} />
              <Stack.Screen name="pressure" options={{ title: "Pressure" }} getId={() => "pressure"} />
            </Stack>
            <IntroGate />
            <SplashGate />
          </ThemeProvider>
          </ExposureProvider>
          </BodyProvider>
        </WalletDataProvider>
      </MarketProvider>
    </MobileWalletProvider>
  );
}
