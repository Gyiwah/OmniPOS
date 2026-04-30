import { Image, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";

type BestSellerRowProps = {
  rank: number;
  imageUrl?: string | null;
  name: string;
  unitsSold: number;
};

export function BestSellerRow({ rank, imageUrl, name, unitsSold }: BestSellerRowProps) {
  const highlight =
    rank === 1 ? Colors.primaryBlue : rank === 2 || rank === 3 ? Colors.accentOrange : Colors.textSecondary;
  return (
    <View style={styles.row}>
      <Text style={[styles.rank, { color: highlight }]}>#{rank}</Text>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.thumb} /> : <View style={[styles.thumb, styles.placeholder]} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.units}>{unitsSold} sold</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  rank: { width: 32, fontWeight: "900", fontSize: 16 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  placeholder: { backgroundColor: Colors.divider },
  name: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  units: { fontSize: 12, color: Colors.textMuted },
});
