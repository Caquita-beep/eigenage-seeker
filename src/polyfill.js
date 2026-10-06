import { install } from "react-native-quick-crypto";

// Mobile Wallet Adapter and @solana/kit expect WebCrypto.
install();

// The engine is shared with the website, where every fetch carries
// AbortSignal.timeout(15000). Hermes has AbortController but not the static
// helper.
if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new Error(`timed out after ${ms} ms`)), ms);
    return c.signal;
  };
}

// The public Solana RPC answers bursts with 429. Reading a wallet's history is
// one getTransaction per signed act, so a busy night of trading is a burst.
// Retry those with backoff rather than failing the whole read; the engine's RPC
// client throws on the first non-2xx and has no reason to know about this.
const baseFetch = global.fetch;
global.fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const res = await baseFetch(input, init);
    if (res.status !== 429 || attempt === 5) return res;
    const after = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
};
