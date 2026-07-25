import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AccentButton } from "@/src/components/atoms/AccentButton";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { usePrinter } from "@/src/hooks/usePrinter";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";

type ReceiptPayload = {
  orderNumber?: string;
  dateLabel?: string;
};

export type ReceiptLine = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type ReceiptData = {
  lines: ReceiptLine[];
  discountMode: "percentage" | "amount";
  discountValue: number;
  amountPaid: number;
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  taxRate: number;
  vatRate: number;
  serviceRate: number;
  currency?: string;
};

type ReceiptDocumentProps = {
  order?: ReceiptPayload;
  store?: { name: string };
  data?: ReceiptData;
  onPrint?: () => void;
  onShare?: () => void;
};

function currencySymbol(code: string) {
  if (code === "USD") return "$";
  if (code === "NGN") return "₦";
  return "₵";
}

function BarcodeVisual() {
  const bars = [2, 1, 3, 1, 2, 2, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1, 2, 3, 1, 2, 1, 3];
  return (
    <View style={styles.barcodeWrap}>
      {bars.map((w, idx) => (
        <View key={`${idx}`} style={[styles.bar, { width: w * 2.2 }]} />
      ))}
    </View>
  );
}

export function ReceiptDocument({ order, store, data, onPrint, onShare }: ReceiptDocumentProps) {
  const draft = useOrderDraftStore();
  const { connected, deviceName } = usePrinter();
  const { lines, discountMode, discountValue, amountPaid, customerName, customerPhone, shippingAddress } =
    useOrderDraftStore();
  const { currency, taxRate, vatRate, serviceRate } = useSettingsStore();
  const sourceLines = data?.lines ?? lines;
  const sourceDiscountMode = data?.discountMode ?? draft.discountMode;
  const sourceDiscountValue = data?.discountValue ?? draft.discountValue;
  const sourceAmountPaid = data?.amountPaid ?? draft.amountPaid;
  const sourceCustomerName = data?.customerName ?? draft.customerName;
  const sourceCustomerPhone = data?.customerPhone ?? draft.customerPhone;
  const sourceShippingAddress = data?.shippingAddress ?? draft.shippingAddress;
  const sourceTaxRate = data?.taxRate ?? taxRate;
  const sourceVatRate = data?.vatRate ?? vatRate;
  const sourceServiceRate = data?.serviceRate ?? serviceRate;
  const sourceCurrency = data?.currency ?? currency;
  const sym = currencySymbol(sourceCurrency);
  const subtotal = sourceLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discount = sourceDiscountMode === "percentage" ? subtotal * (sourceDiscountValue / 100) : sourceDiscountValue;
  const base = Math.max(0, subtotal - discount);
  const tax = base * (sourceTaxRate / 100);
  const vat = base * (sourceVatRate / 100);
  const service = base * (sourceServiceRate / 100);
  const total = base + tax + vat + service;
  const change = Math.max(0, sourceAmountPaid - total);

  return (
    <View style={styles.page}>
      <View style={styles.qrRow}>
        <View style={styles.dot} />
        <Text style={styles.qrText}>QR Code Ready</Text>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerLine}>
          <Text style={styles.receiptTitle}>RECEIPT</Text>
          <Text style={styles.receiptDate}>{order?.dateLabel ?? new Date().toLocaleString()}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Item</Text>
            <Text style={styles.cardTitle}>Price</Text>
          </View>
          {sourceLines.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <Text style={styles.itemText}>
                {line.quantity}x {line.name}
              </Text>
              <Text style={styles.itemPrice}>{(line.price * line.quantity).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {sym} {total.toFixed(2)}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Subtotal</Text>
            <Text style={styles.meta}>{subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Discount</Text>
            <Text style={styles.meta}>
              {sourceDiscountMode === "percentage"
                ? `${sourceDiscountValue}%`
                : `${sym} ${sourceDiscountValue.toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Tax {sourceTaxRate}%</Text>
            <Text style={styles.meta}>{tax.toFixed(2)}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>VAT {sourceVatRate}%</Text>
            <Text style={styles.meta}>{vat.toFixed(2)}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Service {sourceServiceRate}%</Text>
            <Text style={styles.meta}>{service.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.totalLabel}>Change</Text>
            <Text style={styles.totalValue}>
              {sym} {change.toFixed(2)}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Amount Paid</Text>
            <Text style={styles.meta}>{sourceAmountPaid.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer Info</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Name</Text>
            <Text style={styles.meta}>{sourceCustomerName || "Optional"}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Phone</Text>
            <Text style={styles.meta}>{sourceCustomerPhone || "Optional"}</Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Shipping Address</Text>
            <Text style={styles.meta}>{sourceShippingAddress || "Optional"}</Text>
          </View>
        </View>

        <BarcodeVisual />
        <Text style={styles.footerRef}>
          {store?.name ?? "OmniPOS"} · Ref {order?.orderNumber ?? "--"}
        </Text>
      </ScrollView>

      <View style={styles.bottomRow}>
        <View style={styles.printWrap}>
          <PrimaryButton
            label="Print Receipt"
            onPress={() => onPrint?.()}
            fullWidth
            variant="primary"
            disabled={!connected}
          />
          <Text style={[styles.printHint, connected && styles.printHintReady]}>
            {connected ? `Ready · ${deviceName ?? "Printer"}` : "Pair a printer in Settings → Printer"}
          </Text>
        </View>
        <AccentButton label="Share" onPress={() => onShare?.()} fullWidth={false} style={styles.shareBtn} outlined />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.sm },
  qrRow: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: Colors.success },
  qrText: { color: Colors.textSecondary, fontSize: 13 },
  sheet: {
    maxHeight: 560,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  sheetContent: { padding: Spacing.md, gap: Spacing.sm },
  headerLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  receiptTitle: { fontSize: 40, color: Colors.textPrimary, letterSpacing: 1 },
  receiptDate: { fontSize: 12, color: Colors.textSecondary },
  card: { backgroundColor: Colors.background, borderRadius: Radius.input, padding: Spacing.sm + 2, gap: Spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
  itemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm },
  itemText: { flex: 1, fontSize: 14, color: Colors.textSecondary },
  itemPrice: { fontSize: 14, color: Colors.textPrimary },
  totalLabel: { fontSize: 19, fontWeight: "700", color: Colors.textPrimary },
  totalValue: { fontSize: 24, fontWeight: "800", color: Colors.textPrimary },
  meta: { fontSize: 13, color: Colors.textSecondary },
  barcodeWrap: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    height: 58,
    gap: 2,
    marginTop: Spacing.sm,
  },
  bar: { backgroundColor: "#111827", height: "100%" },
  footerRef: { textAlign: "center", color: Colors.textMuted, fontSize: 12 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  printWrap: {
    flex: 1,
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.input,
    padding: 4,
  },
  printHint: {
    textAlign: "center",
    color: Colors.accentOrange,
    fontSize: 12,
    marginTop: 3,
    fontWeight: "700",
  },
  printHintReady: {
    color: Colors.primaryBlue,
  },
  shareBtn: { minWidth: 110 },
});
