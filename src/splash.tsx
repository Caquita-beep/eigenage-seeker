import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useBody, useMarket, useWalletData } from "./data";

/**
 * The launch splash stays up until what the phone has saved — the market, the
 * wallet, the body — is on screen, so Today opens once, complete, instead of
 * showing "connect your data" first and filling in after. Never longer than
 * CAP_MS: anything still coming from the network arrives in place after that.
 */

SplashScreen.preventAutoHideAsync();

const CAP_MS = 4000;

export function SplashGate() {
  const market = useMarket().ready;
  const wallet = useWalletData().ready;
  const body = useBody().ready;

  useEffect(() => {
    const timer = setTimeout(SplashScreen.hide, CAP_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (market && wallet && body) SplashScreen.hide();
  }, [market, wallet, body]);

  return null;
}
