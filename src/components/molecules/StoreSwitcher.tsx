import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";

type StoreRow = { id: string; name: string };

type StoreSwitcherProps = {
  stores: StoreRow[];
  activeId: string | null;
  onSwitch: (id: string) => void;
};

export function StoreSwitcher({ stores, activeId, onSwitch }: StoreSwitcherProps) {
  return (
    <View style={styles.wrap}>
      {stores.map((s) => {
        const active = s.id === activeId;
        return (
          <Pressable key={s.id} onPress={() => onSwitch(s.id)} style={[styles.row, active && styles.rowActive]}>
            <Text style={[styles.label, active && styles.labelActive]}>{s.name}</Text>
            {active ? <Ionicons name="checkmark-circle" size={22} color={Colors.primaryBlue} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  rowActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
    flex: 1,
  },
  labelActive: { color: Colors.primaryBlue },
});
