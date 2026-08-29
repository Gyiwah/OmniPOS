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
  price?: number;
  expiryStatus?: "good" | "expiring_soon" | "expired" | "no_expiry";
  expiryLabel?: string;
  onPress?: () => void;
};

export function ProductCard({
  imageUrl,
  name,
  stockCount,
  lowStockThreshold,
  price,
  expiryStatus,
  expiryLabel,
  onPress,
}: ProductCardProps) {
  const isExpired = expiryStatus === "expired";
  const isExpiringSoon = expiryStatus === "expiring_soon";

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
        <View style={styles.badgeRow}>
          <StockPill count={stockCount} threshold={lowStockThreshold} />
          {expiryStatus && expiryStatus !== "no_expiry" && expiryStatus !== "good" ? (
            <View
              style={[
                styles.expPill,
                isExpired ? styles.expPillExpired : isExpiringSoon ? styles.expPillSoon : null,
              ]}
            >
              <Text
                style={[
                  styles.expText,
                  isExpired ? styles.expTextExpired : isExpiringSoon ? styles.expTextSoon : null,
                ]}
              >
                {expiryLabel ?? (isExpired ? "Expired" : "Expiring soon")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {price != null ? (
        <Text style={styles.priceText}>₵{price.toFixed(2)}</Text>
      ) : null}
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
    gap: 4,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  expPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  expPillExpired: {
    backgroundColor: "#fee2e2",
  },
  expPillSoon: {
    backgroundColor: "#fef3c7",
  },
  expText: {
    fontSize: 10,
    fontWeight: "700",
  },
  expTextExpired: {
    color: "#dc2626",
  },
  expTextSoon: {
    color: "#d97706",
  },
});

