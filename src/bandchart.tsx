import { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import type { ChartPoint } from "./bodyread";
import { color } from "./theme";

/**
 * The method's own chart, small: each night as a dot, the 7-night average as
 * a line, and the normal range as a shaded band. A reader sees at once
 * whether the line has left the band, and since when.
 */
export function BandChart({ points, tint, height = 120, digits = 0 }: { points: ChartPoint[]; tint: string; height?: number; digits?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const vals = points.flatMap((p) => [p.value, p.avg, p.low, p.high]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < 2) return <View style={{ height }} onLayout={onLayout} />;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const LEFT = 0;
  const RIGHT = 34;
  const plotW = Math.max(1, w - LEFT - RIGHT);
  const x = (i: number) => LEFT + (i / Math.max(1, points.length - 1)) * plotW;
  const y = (v: number) => 6 + (1 - (v - min) / (max - min)) * (height - 12);

  // The band and the line, broken wherever a night has no 7-night value.
  const runs: ChartPoint[][] = [];
  let idx: number[][] = [];
  points.forEach((p, i) => {
    if (p.avg !== null && p.low !== null && p.high !== null) {
      if (!runs.length || idx[idx.length - 1].at(-1) !== i - 1) {
        runs.push([]);
        idx.push([]);
      }
      runs[runs.length - 1].push(p);
      idx[idx.length - 1].push(i);
    }
  });
  const band = runs.map((r, k) => {
    const is = idx[k];
    const top = r.map((p, j) => `${j ? "L" : "M"}${x(is[j]).toFixed(1)},${y(p.high!).toFixed(1)}`).join("");
    const bottom = [...r].reverse().map((p, j) => `L${x(is[is.length - 1 - j]).toFixed(1)},${y(p.low!).toFixed(1)}`).join("");
    return `${top}${bottom}Z`;
  });
  const line = runs.map((r, k) => r.map((p, j) => `${j ? "L" : "M"}${x(idx[k][j]).toFixed(1)},${y(p.avg!).toFixed(1)}`).join(""));
  const last = [...points].reverse().find((p) => p.avg !== null);

  return (
    <View onLayout={onLayout} style={{ height }}>
      {w > 0 ? (
        <>
          <Svg width={w} height={height}>
            <Rect x={LEFT} y={0} width={plotW} height={height} fill="none" />
            {band.map((d, k) => (
              <Path key={`b${k}`} d={d} fill={tint} opacity={0.16} />
            ))}
            {points.map((p, i) => (p.value !== null ? <Circle key={p.night} cx={x(i)} cy={y(p.value)} r={2} fill={color.muted} opacity={0.7} /> : null))}
            {line.map((d, k) => (
              <Path key={`l${k}`} d={d} stroke={tint} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
            ))}
            <Line x1={LEFT + plotW} x2={LEFT + plotW} y1={0} y2={height} stroke={color.line} strokeWidth={1} />
          </Svg>
          <Text style={{ position: "absolute", right: 0, top: y(max - pad) - 7, fontSize: 10.5, color: color.faint }}>{(max - pad).toFixed(digits)}</Text>
          <Text style={{ position: "absolute", right: 0, top: y(min + pad) - 7, fontSize: 10.5, color: color.faint }}>{(min + pad).toFixed(digits)}</Text>
          {last?.avg != null ? (
            <Text style={{ position: "absolute", right: 0, top: y(last.avg) - 7, fontSize: 10.5, fontWeight: "700", color: tint }}>{last.avg.toFixed(digits)}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
