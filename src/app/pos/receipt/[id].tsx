import { useLocalSearchParams } from "expo-router";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { ReceiptDocument } from "@/src/components/organisms/ReceiptDocument";
import { MOCK_STORE_NAME } from "@/src/lib/uiMock";

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const ref = Array.isArray(id) ? id[0] : id ?? "—";

  return (
    <AppScrollScreen showBack title="Receipt" subtitle={`Reference · ${ref}`}>
      <ReceiptDocument
        store={{ name: MOCK_STORE_NAME }}
        order={{
          orderNumber: String(ref),
          dateLabel: "Apr 29, 2026 · 2:16 PM",
          totalsLine: "Subtotal · ₵ 51.80\nTax · ₵ 3.70\nTotal · ₵ 55.50",
        }}
        onPrint={() => {}}
        onShare={() => {}}
      />
    </AppScrollScreen>
  );
}
