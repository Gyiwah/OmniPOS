import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { Colors } from "@/src/constants/colors";

type Point = { label: string; value: number };

type SalesLineChartProps = {
  data: Point[];
  period?: string;
};

function buildPath(points: Point[], height: number, width: string | number) {
  const w = typeof width === "number" ? width : 320;
  if (!points.length) return "";
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = w / Math.max(points.length - 1, 1);
  return points.reduce((acc, p, idx) => {
    const x = idx * step;
    const y = height - (p.value / max) * height * 0.85;
    return `${acc} ${idx === 0 ? "M" : "L"} ${x} ${y}`;
  }, "");
}

export function SalesLineChart({ data, period }: SalesLineChartProps) {
  const width = 320;
  const height = 120;
  const path = buildPath(data, height, width);
  const fillPath =
    path && data.length ? `${path} L ${width} ${height} L 0 ${height} Z` : "";

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>{period ?? "Sales trend"}</Text>
      {data.length === 0 ? (
        <Text style={styles.empty}>No chart data yet</Text>
      ) : (
        <Svg height={height + 24} width="100%" viewBox={`0 -10 ${width} ${height + 40}`}>
          <Defs>
            <LinearGradient id="salesFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={Colors.primaryBlue} stopOpacity="0.22" />
              <Stop offset="100%" stopColor={Colors.primaryBlue} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Line x1={0} y1={height} x2={width} y2={height} stroke={Colors.border} strokeWidth={1} />
          {fillPath ? <Path d={fillPath} fill="url(#salesFill)" /> : null}
          {path ? <Path d={path} stroke={Colors.primaryBlue} strokeWidth={3} fill="none" /> : null}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  caption: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 8,
    fontWeight: "600",
  },
  empty: {
    paddingVertical: 24,
    textAlign: "center",
    color: Colors.textMuted,
  },
});
