# Heart Alpha

by EigenAge, for the Solana Seeker.

**Read your trading the way an athlete reads their training.**

Heart Alpha is an Android app for the Solana Seeker that brings together three things a trader rarely sees side by side: what their body did overnight, what the market is doing, and what their wallet actually did. Each morning it says whether to trade as planned or trade smaller. Over weeks it shows how the trader's own history links the three.

Everything is computed on the phone. Health data, wallet history and results never leave the device.

Built for [CLOCK IN](https://solanamobile.com/blog/clock-in-the-solana-mobile-hackathon), the Solana Mobile hackathon.

## Where things are in the code

| What | Where |
|---|---|
| Bluetooth chest strap (Kotlin, Expo module): scans, connects, streams beat-to-beat intervals from the standard Heart Rate service | [`modules/heart-strap/android/.../HeartStrapModule.kt`](modules/heart-strap/android/src/main/java/org/eigenage/heartstrap/HeartStrapModule.kt), JS side [`src/strap.ts`](src/strap.ts) |
| The morning reading: settle minute, recording, live chart | [`src/app/reading.tsx`](src/app/reading.tsx) |
| HRV maths: rMSSD from RR intervals, artefact filtering (beats >20% off their neighbours skipped) | [`src/rr.ts`](src/rr.ts) (`analyse`) |
| Baselines and the daily assessment: 7-day mean vs personal normal, CV against the usual swing, quick read from day 2 | [`src/engine/hrv.ts`](src/engine/hrv.ts) (`banded`, `progressive`, `cvBands`, `trends`), call and size in [`src/insight.ts`](src/insight.ts) (`action`) |
| Mobile Wallet Adapter (read-only connect, several wallets) | [`src/app/_layout.tsx`](src/app/_layout.tsx) (`MobileWalletProvider`), [`src/data.tsx`](src/data.tsx) (`useMobileWallet`), [`src/wallets.ts`](src/wallets.ts) |
| Transaction import from Solana RPC (signed history, swaps per night) | [`src/engine/rpc.ts`](src/engine/rpc.ts), [`src/engine/wallet.ts`](src/engine/wallet.ts), [`src/wallet.ts`](src/wallet.ts) |
| FIFO realised P&L | [`src/engine/journal.ts`](src/engine/journal.ts) (`ledger`), by night in [`src/pnl.ts`](src/pnl.ts) |
| Trading as a sport: sessions, load, intensity | [`src/sport.ts`](src/sport.ts) |
| Correlations with a chance band; pre-registered tests with a block bootstrap | [`src/drivers.ts`](src/drivers.ts), [`src/engine/hypotheses.ts`](src/engine/hypotheses.ts), [`src/engine/stats.ts`](src/engine/stats.ts) |
| Breathing guide with live HRV | [`src/app/breathe.tsx`](src/app/breathe.tsx), [`src/livehrv.tsx`](src/livehrv.tsx), [`src/breathadvice.ts`](src/breathadvice.ts) |
| Charts (pinch, pan, crosshair, indicator panes) | [`src/prochart.tsx`](src/prochart.tsx) |

Setup and build: see [Build](#build). Release APK, deck and demo video: [Releases](https://github.com/Caquita-beep/eigenage-seeker/releases).

## What it shows

| Tab | What's on it |
|---|---|
| **Today** | The morning assessment: an action ("Trade as planned", "Trade smaller", "Stand aside today") with a position size, read from the body's state and the market's, and as its last row when to breathe and for how long. Tapping the action opens every morning's assessment as a chart (a bar a morning, taller the better the body's state), with the body signals, the market, the trading load and realised P&L laid underneath on the same days; tapping HRV, CV or resting HR opens that signal's chart. Below it: a month calendar of realised P&L with a dot for how your body started each day, then the trading load (this week's share of the wallet moved against the four weeks before it, plus rest days) and the intensity mix (each trading day easy, moderate or hard, with each kind's next-day result and the next morning's HRV), each showing its numbers and opening to its chart or table when tapped. |
| **Insights** | Trading read as a sport. The last 90 days first, on one time axis; then your coins against what they cost. **P&L:** realised P&L (what sells made over cost, first in, first out, by day) can be laid under every chart that takes indicators, the body's, the price charts, the market series, the trading load and the assessments, as daily bars with the running total as a hairline on its own scale; it is an outcome and a factor in the correlations, and a column wherever trading days are split. **When you trade best**, shut to its numbers until tapped: your trades split by body state, SOL's moves, market mood, clock and the week coming in. **Tested links:** pre-registered questions tested against your history. |
| **Body** | HRV (rMSSD), its night-to-night variability (CV) and resting heart rate. Each is shown as a 7-day average against your own normal range, the up to 60 days before that week, with charts. The read starts quickly and sharpens, as Oura and Elite HRV do: on the first morning the advice is the market's; from the second, that morning against the ones before it (only a morning well outside where 19 in 20 land counts, and reads as Acute stress); from about 10 mornings the weekly read, early until 14 and sharper with every night to 60. Until there are mornings enough to measure your day-to-day swing, it starts from a typical one (about 15% for HRV, 3 bpm for resting heart rate) and becomes yours as they add up. |
| **Market** | Volatility (DVOL and SOL's realised moves), how SOL moves with BTC and with priced fear (30-day correlations), and sentiment (Fear & Greed). |
| **Wallet** | Total balance in a ring by coin, each coin with its average cost and position, and pro charts with your own buys and sells marked. Body metrics can be plotted as indicators under any chart. |

## How it reads the body

HRV is read each morning: a chest strap gives a one-minute reading on waking, and each day is paired with the next morning's HRV. The readings are averaged over 7 days on a log scale and compared with your own 60-day normal range. Together with the variability (CV) and resting heart rate, this places the body in one of five states: coping well, stable, acute stress, maladaptation or accumulated fatigue. That state, combined with the market's (calm, nervous, greedy or wild), sets the morning action and the size.

About Heart Alpha, at the foot of Today, has the version, where the data comes from and stays, and how to reach the developer (eigenage.org, support@eigenage.org).

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
| **Body** | A Bluetooth chest strap (a Polar H10 or any strap sending beat-to-beat intervals), read by the phone itself: no wearable company's cloud in between. In test builds only, a synthetic data set lets the app be tried without a strap. |
| **Chest strap** | A Polar H10, or any Bluetooth strap that sends beat-to-beat intervals in the standard Heart Rate service. One minute each morning on waking, after the bathroom, sitting still, after a minute to settle that is not recorded (How to measure gives the protocol step by step): the app computes rMSSD on the phone from the intervals, skipping beats more than 20% off their neighbours, and shows it beat by beat as it records, with the HRV so far as a line or as candles. A reading is taken breathing normally, since slow, paced breathing lifts HRV and blurs one morning against the next. The length (one minute by default, up to twenty) is kept with each reading, since it moves the figure too, and a morning set up unlike the last one says so. Breathing is an exercise of its own, from the last row of the assessment, which says when and how long by the body's state (every day, 10 minutes, after the reading, when steady; 5 minutes before trading and after a loss on Acute stress; 15 minutes before bed on Accumulated fatigue; both on Maladaptation) and stands out on strained days. Breathe shows why, counts to that length, warns when the morning reading is not yet taken (slow breathing lifts HRV for a while after), and links How to breathe: slow, about six a minute, gently, and the live HRV is not recovery. It is a guide (resonance at 5.5 breaths a minute, long exhale, box, 4-7-8, sigh; drawn as a hexagon, an orb or a wave), with HRV over the last minute shown live when the strap is on. Nothing from it is saved. Every reading is kept: those taken before 14:00 are the morning's and make the trend; later ones are kept apart, shown with the mornings on the Readings screen, by date or by hour. Today always has the morning's reading, or the button to take it. |
| **Wallet** | Connected with Mobile Wallet Adapter (`@wallet-ui/react-native-kit`), read-only. Several wallets can be added and switched between on the Wallet tab; each one's history is kept apart on the phone. They can also be read together, all of them or any two or more, as one combined wallet: each swap's load is taken against the wallets' combined balance, holdings and average cost are added up coin by coin, and realised profit is matched first in, first out across them. History comes from Solana RPC. A synthetic trader is available in test builds only. |
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

The app people install has no synthetic data and cannot make any. For trying the screens without a wearable or a trading history, a test build turns on synthetic body and wallet data and a simulated strap; synthetic data left by a test build is cleared when the shipped app opens:

```bash
EXPO_PUBLIC_SYNTHETIC=1 npx expo run:android --variant release   # test build
```

## Stack

Expo SDK 57, React Native 0.86, Expo Router, React Native SVG, Reanimated (the launch animation, `src/splash.tsx`: the mark drawn on from its centre lines, `src/logo.ts`), `react-native-health-connect`, `@solana/kit`, and `@wallet-ui/react-native-kit` (Mobile Wallet Adapter). The strap is read by a small local Expo module, `modules/heart-strap` (Android BLE, Heart Rate service 0x180D); the bytes are parsed and read in `src/rr.ts`.

The statistics and data assembly in `src/engine/` are shared with the EigenAge website and copied in with `scripts/sync-engine.sh`.

## Not medical advice

Heart Alpha describes patterns in your own data. It does not diagnose anything, and nothing in it is financial or medical advice.
