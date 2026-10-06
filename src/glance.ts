import { color } from "./theme";

/**
 * A headline word with its tone and one instruction, and the one-word checks
 * beside it: the shape of the Wallet tab's headline (`walletread.ts`).
 */

export type Tone = "good" | "watch" | "bad" | "neutral";

export const TONE: Record<Tone, string> = {
  good: "#3E9E6E",
  watch: "#C9733F",
  bad: "#C43D4B",
  neutral: color.muted,
};

export interface Check {
  id: string;
  label: string;
  word: string;
  tone: Tone;
  route: string;
}

export interface Glance {
  word: string;
  tone: Tone;
  advice: string;
  /** One short line under the instruction, only when something needs saying (stale data). */
  note?: string | null;
  checks: Check[];
}
