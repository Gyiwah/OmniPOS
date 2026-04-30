import { useLocalSearchParams } from "expo-router";
import { Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { ReceiptDocument } from "@/src/components/organisms/ReceiptDocument";
import { Colors } from "@/src/constants/colors";
import { MOCK_STORE_NAME } from "@/src/lib/uiMock";

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const ref = Array.isArray(id) ? id[0] : id ?? "—";

  return (
    <AppScrollScreen
      showBack
      title="Order Receipt"
      subtitle={`Reference · ${ref}`}
      right={
        <Pressable hitSlop={8}>
          <Ionicons name="qr-code-outline" size={24} color={Colors.textSecondary} />
        </Pressable>
      }
    >
      <ReceiptDocument
        store={{ name: MOCK_STORE_NAME }}
        order={{
          orderNumber: String(ref),
          dateLabel: "Apr 29, 2026 · 2:16 PM",
        }}
        onPrint={() => {}}
        onShare={() => {}}
      />
    </AppScrollScreen>
  );
}
