import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { Colors } from "@/src/constants/colors";

type BarDatum = {
  label: string;
  sales: number;
  returns?: number;
};

type OrdersBarChartProps = {
  data: BarDatum[];
  period?: string;
};

export function OrdersBarChart({ data, period }: OrdersBarChartProps) {
  const width = 320;
  const height = 140;
  const gap = 8;
  const slot = width / Math.max(data.length, 1);
  const max = Math.max(...data.map((d) => Math.max(d.sales, d.returns ?? 0)), 1);

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>{period ?? "Orders vs returns"}</Text>
      {data.length === 0 ? (
        <Text style={styles.empty}>No bar metrics yet</Text>
      ) : (
        <Svg height={height} width="100%" viewBox={`0 0 ${width} ${height}`}>
          {data.map((d, idx) => {
            const cx = idx * slot + gap;
            const w = Math.max(slot - gap * 2, 4);
            const salesH = (d.sales / max) * (height - 24);
            const retH = ((d.returns ?? 0) / max) * (height - 24);
            return (
              <Fragment key={`bar-${idx}`}>
                <Rect
                  x={cx}
                  y={height - salesH}
                  width={w / 2 - 2}
                  height={salesH}
                  fill={Colors.primaryBlue}
                  rx={4}
                  ry={4}
                />
                <Rect
                  x={cx + w / 2}
                  y={height - retH}
                  width={w / 2 - 2}
                  height={retH}
                  fill={Colors.accentOrange}
                  rx={4}
                  ry={4}
                />
              </Fragment>
            );
          })}
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
