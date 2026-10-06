/**
 * One dark palette. The app is read at night as often as in the day, and the
 * three sources each get one colour everywhere they appear: market is cold,
 * wallet is warm, body is green. A number's colour says where it came from.
 */
export const color = {
  bg: "#08090B",
  surface: "#111317",
  raised: "#181B21",
  line: "#23272F",
  text: "#EDEEF0",
  muted: "#8B919C",
  faint: "#555B66",

  market: "#7AA2F7",
  wallet: "#E8A45C",
  body: "#6BCB8B",

  below: "#E06C75",
  within: "#8B919C",
  above: "#7AA2F7",

  /** Marks data that was generated, not measured. Used for nothing else. */
  synthetic: "#D9B44A",
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const type = {
  hero: { fontSize: 44, fontWeight: "600" as const, letterSpacing: -1, color: color.text },
  title: { fontSize: 22, fontWeight: "600" as const, color: color.text },
  value: { fontSize: 26, fontWeight: "600" as const, color: color.text, fontVariant: ["tabular-nums" as const] },
  body: { fontSize: 15, lineHeight: 21, color: color.text },
  small: { fontSize: 13, lineHeight: 18, color: color.muted },
  label: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 1.2, color: color.muted, textTransform: "uppercase" as const },
};
