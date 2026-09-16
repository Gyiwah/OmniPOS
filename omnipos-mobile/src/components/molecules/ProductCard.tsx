import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { StockPill } from "@/src/components/atoms/StockPill";

type ProductCardProps = {
  imageUrl?: string | null;
  imageHeaders?: Record<string, string>;
  name: string;
  sku?: string;
  stockCount: number;
  lowStockThreshold: number;
  price?: number;
  costPrice?: number | null;
  currencySymbol?: string;
  expiryStatus?: "good" | "expiring_soon" | "expired" | "no_expiry";
  expiryLabel?: string;
  onPress?: () => void;
};

export function ProductCard({
  imageUrl,
  imageHeaders,
  name,
  sku,
  stockCount,
  lowStockThreshold,
  price,
  costPrice,
  currencySymbol = "₵",
  expiryStatus,
  expiryLabel,
  onPress,
}: ProductCardProps) {
  const isExpired = expiryStatus === "expired";
  const isExpiringSoon = expiryStatus === "expiring_soon";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.wrapPressed]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl, headers: imageHeaders }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text style={styles.placeholderInitial}>
            {name ? name.charAt(0).toUpperCase() : "P"}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {sku ? <Text style={styles.skuText}>SKU: {sku}</Text> : null}
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
      <View style={styles.priceColumn}>
        {price != null ? (
          <Text style={styles.priceText}>
            {currencySymbol} {price.toFixed(2)}
          </Text>
        ) : null}
        {costPrice != null ? (
          <Text style={styles.costText}>
            Cost: {currencySymbol} {Number(costPrice).toFixed(2)}
          </Text>
        ) : null}
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
    padding: Spacing.sm + 2,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...Elevation.card,
  },
  wrapPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  thumbPlaceholder: {
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  placeholderInitial: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  skuText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textMuted,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  priceColumn: {
    alignItems: "flex-end",
    gap: 2,
  },
  priceText: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  costText: {
    fontSize: 11,
    fontWeight: "500",
    color: Colors.textMuted,
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

