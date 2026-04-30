import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { StockPill } from "@/src/components/atoms/StockPill";

type ProductCardProps = {
  imageUrl?: string | null;
  name: string;
  stockCount: number;
  lowStockThreshold: number;
  onPress?: () => void;
};

export function ProductCard({ imageUrl, name, stockCount, lowStockThreshold, onPress }: ProductCardProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.96 }]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <StockPill count={stockCount} threshold={lowStockThreshold} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.sm,
    gap: Spacing.sm,
    ...Elevation.card,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  thumbPlaceholder: {
    backgroundColor: Colors.primaryBluePale,
  },
  body: {
    flex: 1,
    gap: Spacing.xs,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
});
