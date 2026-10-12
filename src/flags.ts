/**
 * Test-only features: synthetic body and wallet data, and the simulated strap.
 * On only in a build made with EXPO_PUBLIC_SYNTHETIC=1, for trying the screens
 * without a wearable or a trading history. The app people install has none of
 * them and cannot make any; synthetic data left from a test build is cleared
 * on opening (`data.tsx`).
 *
 * Read as `process.env.EXPO_PUBLIC_SYNTHETIC` literally: Expo inlines it into
 * the bundle at build time only in that form.
 */
export const TESTING = process.env.EXPO_PUBLIC_SYNTHETIC === "1";
