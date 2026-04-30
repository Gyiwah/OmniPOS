import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

export type CartLine = {
  id: string;
  name: string;
  quantity: number;
  unitPriceLabel: string;
};

type CartItemProps = {
  product: CartLine;
  onIncrement: () => void;
  onDecrement: () => void;
};

export function CartItem({ product, onIncrement, onDecrement }: CartItemProps) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.price}>{product.unitPriceLabel}</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable onPress={onDecrement} style={styles.btn}>
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.qty}>{product.quantity}</Text>
        <Pressable onPress={onIncrement} style={styles.btn}>
          <Text style={styles.btnText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  name: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  price: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 18,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  qty: {
    fontSize: 16,
    fontWeight: "800",
    minWidth: 24,
    textAlign: "center",
    color: Colors.textPrimary,
  },
});
