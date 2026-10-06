/**
 * Solana JSON-RPC, over `fetch`.
 *
 * Same shape and same argument as `billing/stripe.ts`: two methods and no
 * client library. `@solana/web3.js` is a large dependency that exists mostly to
 * build and sign transactions, and this server does neither — it reads. It has
 * no key, it cannot move a token, and the entire surface it needs is two calls
 * that return JSON.
 *
 * ── Finalized, everywhere, without exception ──────────────────────────────
 * Solana offers `processed`, `confirmed` and `finalized`. The first two can
 * still be rolled back — rarely, but "rarely" is a strange thing to design a
 * payment around when the cost of waiting is about thirteen seconds. Access
 * granted against a confirmed-but-not-finalized transfer can be granted against
 * a transfer that never happened, and nothing later would notice.
 */

const TIMEOUT_MS = 15000;

export function rpcUrl(): string {
  const url = (process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");
  if (!url) throw new Error("SOLANA_RPC_URL is not set");
  return url;
}

let nextId = 1;

async function call<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Solana RPC ${res.status} on ${method}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(`Solana RPC ${method}: ${json.error.message ?? "error"}`);
  return json.result as T;
}

export interface SignatureInfo {
  signature: string;
  /** Non-null when the transaction ran and failed. It still cost a fee. */
  err: unknown | null;
  blockTime: number | null;
}

/**
 * Recent transactions mentioning `address`, newest first.
 *
 * This is the whole reason a reference key exists: the RPC indexes transactions
 * by every account they name, so a payment that carries a reference we minted
 * can be found by asking about that reference alone — no scanning of the
 * merchant wallet, no guessing which of three identical transfers belongs to
 * which reader.
 *
 * The limit is small on purpose. A reference is used once, so anything but the
 * first page means something is wrong rather than something is paginated.
 */
export async function signaturesForAddress(
  address: string,
  limit = 10,
  before?: string,
): Promise<SignatureInfo[]> {
  return call<SignatureInfo[]>("getSignaturesForAddress", [
    address,
    { limit, commitment: "finalized", ...(before ? { before } : {}) },
  ]);
}

/** One entry of a transaction's token balances, before or after it ran. */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  /** The wallet that owns the token account — not the token account itself. */
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface TransactionMeta {
  /** Null when the transaction succeeded. Anything else means it did not. */
  err: unknown | null;
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
  /** Lamports per account, in `accountKeys` order. Exposure sizes trades by them. */
  preBalances?: number[];
  postBalances?: number[];
  fee?: number;
}

export interface ConfirmedTransaction {
  slot: number;
  blockTime: number | null;
  meta: TransactionMeta | null;
  /** jsonParsed marks which accounts signed — how Exposure tells the wallet's
   *  own actions from things other people sent it. */
  transaction?: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
}

/**
 * One finalized transaction.
 *
 * `maxSupportedTransactionVersion` has to be passed or the RPC refuses any
 * versioned transaction with an error rather than returning it — and versioned
 * transactions are what most wallets now send, so omitting it means the payments
 * that fail to settle are exactly the ones from modern wallets.
 */
export async function transaction(signature: string): Promise<ConfirmedTransaction | null> {
  return call<ConfirmedTransaction | null>("getTransaction", [
    signature,
    {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
      encoding: "jsonParsed",
    },
  ]);
}
