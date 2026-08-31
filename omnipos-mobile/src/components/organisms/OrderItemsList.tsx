import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CartItem, type CartLine } from "@/src/components/molecules/CartItem";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";

export type CartLineLite = Pick<CartLine, "id" | "name" | "quantity"> & {
  unitPriceLabel: string;
};

type OrderItemsListProps = {
  items: CartLineLite[];
  onUpdateQty: (productId: string, quantity: number) => void;
  readOnly?: boolean;
  totalLabel: string;
};

export function OrderItemsList({ items, onUpdateQty, readOnly = false, totalLabel }: OrderItemsListProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.list}>
        {items.map((item) =>
          readOnly ? (
            <View key={item.id} style={styles.readRow}>
              <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                x{item.quantity} · {item.unitPriceLabel}
              </Text>
            </View>
          ) : (
            <Fragment key={item.id}>
              <CartItem
                product={item}
                onIncrement={() => onUpdateQty(item.id, item.quantity + 1)}
                onDecrement={() => onUpdateQty(item.id, Math.max(0, item.quantity - 1))}
              />
            </Fragment>
          ),
        )}
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLbl}>Total</Text>
        <Text style={styles.totalVal}>{totalLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  readRow: { paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  rowName: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  rowMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  totalLbl: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  totalVal: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
});
