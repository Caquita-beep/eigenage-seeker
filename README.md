# EigenAge for Seeker

**Read your trading the way an athlete reads their training.**

EigenAge is an Android app for the Solana Seeker that brings together three things a trader rarely sees side by side: what their body did overnight, what the market is doing, and what their wallet actually did. Each morning it says whether to trade as planned or trade smaller. Over weeks it shows how the trader's own history links the three.

Everything is computed on the phone. Health data, wallet history and results never leave the device.

Built for [CLOCK IN](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon), the Solana Mobile hackathon.

## What it shows

| Tab | What's on it |
|---|---|
| **Today** | The morning assessment: an action ("Trade as planned", "Trade smaller", "Stand aside today") with a position size, read from the body's state and the market's. Below it: the wallet balance in a ring by coin, yesterday's trading against your usual, and a month calendar of realised P&L with a dot for how your body started each day. |
| **Insights** | Trading read as a sport. **Load:** this week's share of the wallet moved against the four weeks before it, plus rest days. **Intensity mix:** each trading day is easy, moderate or hard, with each kind's next-day result and the next morning's HRV. **When you trade best:** your trades split by body state, SOL's moves, market mood, clock and the week coming in. **Tested links:** pre-registered questions tested against your history. |
| **Body** | HRV (rMSSD), its night-to-night variability (CV) and resting heart rate. Each is shown as a 7-day average against your own 60-day normal range, with charts. |
| **Market** | Volatility (DVOL and SOL's realised moves), how SOL moves with BTC and with priced fear (30-day correlations), and sentiment (Fear & Greed). |
| **Wallet** | Total balance in a ring by coin, each coin with its average cost and position, and pro charts with your own buys and sells marked. Body metrics can be plotted as indicators under any chart. |

## How it reads the body

HRV from a wearable is recorded during sleep and shown the next morning, so each day is paired with the next morning's HRV. Its readings are averaged over 7 days on a log scale and compared with your own 60-day normal range. Together with the variability (CV) and resting heart rate, this places the body in one of five states: coping well, stable, acute stress, maladaptation or accumulated fatigue. That state, combined with the market's (calm, nervous, greedy or wild), sets the morning action and the size.

## How it tests links

The **Tested links** are a fixed, pre-registered set of questions, for example "after a day your coins gain 5%, is your HRV different the next morning, beyond what the market's day explains?". Each is answered with a block bootstrap over your own history, adjusting for the market's day. When one question is asked once per coin, the coins split the 5% error rate between them. A question with too little data says what it is still waiting for instead of guessing.

## Trading as a sport

- **Session.** Each day's swaps are one trading session.
- **Load.** The session's load is the share of liquid holdings swapped.
- **Intensity.** A session counts as harder for each of these: twice your usual day's size, being on-chain past midnight, or SOL moving twice its usual amount that day. None makes it easy, one moderate, two or more hard.
- **Results.** Each trade is scored by its coin's move over the next day, and realised profit is matched first in, first out.

Nothing has to be entered by hand.

## Data sources

| Source | What it provides |
|---|---|
| **Body** | Health Connect (Oura, WHOOP, Garmin, Fitbit, Samsung and others), or an Apple Health `export.zip`. A synthetic data set lets the app be tried without a wearable. |
| **Wallet** | Connected with Mobile Wallet Adapter (`@wallet-ui/react-native-kit`), read-only. History comes from Solana RPC. A synthetic trader is available for trying the app. |
| **Market** | Binance (SOL and BTC daily bars), Deribit (DVOL), alternative.me (Fear & Greed), DexScreener and GeckoTerminal (coin prices and charts). |

## Build

Requires Node 20+, the Android SDK and a device or emulator.

```sh
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

For development, `npx expo run:android` builds a development client.

Set `EXPO_PUBLIC_SOLANA_RPC_URL` to use your own RPC endpoint. The app otherwise falls back to the public mainnet endpoint, which is rate-limited.

## Stack

Expo SDK 57, React Native 0.86, Expo Router, React Native SVG, `react-native-health-connect`, `@solana/kit`, and `@wallet-ui/react-native-kit` (Mobile Wallet Adapter).

The statistics and data assembly in `src/engine/` are shared with the EigenAge website and copied in with `scripts/sync-engine.sh`.

## Not medical advice

EigenAge describes patterns in your own data. It does not diagnose anything, and nothing in it is financial or medical advice.
