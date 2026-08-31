import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export type PricePoint = {
  date: string; // e.g. "Aug 29" or ISO
  sellPrice: number;
  costPrice?: number | null;
  reason?: string;
};

type PriceTrendChartProps = {
  data: PricePoint[];
  currencySymbol?: string;
  width?: number;
  height?: number;
};

export function PriceTrendChart({
  data,
  currencySymbol = "₵",
  width = 320,
  height = 180,
}: PriceTrendChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data;
  }, [data]);

  const { minPrice, maxPrice, latestPrice, initialPrice, percentChange, points } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        minPrice: 0,
        maxPrice: 0,
        latestPrice: 0,
        initialPrice: 0,
        percentChange: 0,
        points: [],
      };
    }

    const prices = chartData.map((d) => d.sellPrice);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const initial = prices[0];
    const latest = prices[prices.length - 1];
    const pct = initial === 0 ? 0 : ((latest - initial) / initial) * 100;

    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const range = max === min ? (max === 0 ? 1 : max * 0.2) : max - min;
    const baselineMin = Math.max(0, min - range * 0.1);
    const baselineMax = max + range * 0.1;
    const dynamicRange = baselineMax - baselineMin || 1;

    const pts = chartData.map((d, index) => {
      const x =
        chartData.length === 1
          ? padLeft + chartW / 2
          : padLeft + (index / (chartData.length - 1)) * chartW;
      const y = padTop + chartH - ((d.sellPrice - baselineMin) / dynamicRange) * chartH;
      return { x, y, price: d.sellPrice, date: d.date, reason: d.reason };
    });

    return {
      minPrice: min,
      maxPrice: max,
      latestPrice: latest,
      initialPrice: initial,
      percentChange: pct,
      points: pts,
    };
  }, [chartData, width, height]);

  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    if (points.length === 1) {
      return `M ${points[0].x - 20} ${points[0].y} L ${points[0].x + 20} ${points[0].y}`;
    }
    return points.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`, "");
  }, [points]);

  const fillD = useMemo(() => {
    if (points.length < 2) return "";
    const first = points[0];
    const last = points[points.length - 1];
    const bottomY = height - 30;
    return `${pathD} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  }, [points, pathD, height]);

  if (chartData.length === 0) {
    return (
      <View style={[styles.emptyContainer, { height }]}>
        <Text style={styles.emptyText}>No price history recorded yet.</Text>
      </View>
    );
  }

  const isPositive = percentChange > 0;
  const isNegative = percentChange < 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.caption}>Latest Sell Price</Text>
          <Text style={styles.priceHero}>
            {currencySymbol} {latestPrice.toFixed(2)}
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            isPositive
              ? styles.badgePositive
              : isNegative
              ? styles.badgeNegative
              : styles.badgeNeutral,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              isPositive
                ? styles.badgeTextPositive
                : isNegative
                ? styles.badgeTextNegative
                : styles.badgeTextNeutral,
            ]}
          >
            {isPositive ? "+" : ""}
            {percentChange.toFixed(1)}%
          </Text>
        </View>
      </View>

      <Svg width={width} height={height} style={styles.svg}>
        <Defs>
          <LinearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={Colors.primaryBlue} stopOpacity="0.25" />
            <Stop offset="1" stopColor={Colors.primaryBlue} stopOpacity="0.0" />
          </LinearGradient>
        </Defs>

        {/* Horizontal grid lines */}
        <Line
          x1={40}
          y1={20}
          x2={width - 20}
          y2={20}
          stroke={Colors.border}
          strokeDasharray="4,4"
          strokeWidth={1}
        />
        <Line
          x1={40}
          y1={height / 2}
          x2={width - 20}
          y2={height / 2}
          stroke={Colors.border}
          strokeDasharray="4,4"
          strokeWidth={1}
        />
        <Line
          x1={40}
          y1={height - 30}
          x2={width - 20}
          y2={height - 30}
          stroke={Colors.border}
          strokeWidth={1}
        />

        {/* Min / Max Labels */}
        <SvgText
          x={35}
          y={25}
          fill={Colors.textMuted}
          fontSize={10}
          textAnchor="end"
        >
          {maxPrice.toFixed(0)}
        </SvgText>
        <SvgText
          x={35}
          y={height - 32}
          fill={Colors.textMuted}
          fontSize={10}
          textAnchor="end"
        >
          {minPrice.toFixed(0)}
        </SvgText>

        {/* Gradient fill underneath */}
        {fillD ? <Path d={fillD} fill="url(#priceGradient)" /> : null}

        {/* Trend Line */}
        <Path
          d={pathD}
          fill="none"
          stroke={Colors.primaryBlue}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Point markers */}
        {points.map((pt, i) => (
          <Circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={4.5}
            fill={Colors.surface}
            stroke={Colors.primaryBlue}
            strokeWidth={2}
          />
        ))}

        {/* Date labels on bottom axis */}
        {points.length > 0 ? (
          <>
            <SvgText
              x={points[0].x}
              y={height - 12}
              fill={Colors.textMuted}
              fontSize={10}
              textAnchor={points.length === 1 ? "middle" : "start"}
            >
              {points[0].date}
            </SvgText>
            {points.length > 1 ? (
              <SvgText
                x={points[points.length - 1].x}
                y={height - 12}
                fill={Colors.textMuted}
                fontSize={10}
                textAnchor="end"
              >
                {points[points.length - 1].date}
              </SvgText>
            ) : null}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  caption: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  priceHero: {
    ...Typography.title,
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  badgePositive: {
    backgroundColor: "#dcfce7",
  },
  badgeNegative: {
    backgroundColor: "#fee2e2",
  },
  badgeNeutral: {
    backgroundColor: Colors.background,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  badgeTextPositive: {
    color: "#16a34a",
  },
  badgeTextNegative: {
    color: "#dc2626",
  },
  badgeTextNeutral: {
    color: Colors.textMuted,
  },
  svg: {
    alignSelf: "center",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textMuted,
  },
});
