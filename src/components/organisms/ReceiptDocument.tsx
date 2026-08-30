import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
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

import { encodeCode128B } from "@/src/utils/barcodeEncoder";

function BarcodeVisual({ code }: { code: string }) {
  const segments = encodeCode128B(code);
  return (
    <View style={styles.barcodeWrap}>
      <View style={styles.barcodeBars}>
        {segments.map((seg, idx) => (
          <View
            key={`bar-${idx}`}
            style={{
              flexGrow: seg.width,
              flexBasis: 0,
              height: "100%",
              backgroundColor: seg.isBlack ? Colors.navyDark : "transparent",
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function ReceiptDocument({ order, store, data, onPrint, onShare }: ReceiptDocumentProps) {
  const draft = useOrderDraftStore();
  const settings = useSettingsStore();
  const { connected, deviceName } = usePrinter();
  const sourceLines: ReceiptLine[] = (data?.lines ?? draft.lines) || [];
  const sourceDiscountMode = data?.discountMode ?? draft.discountMode;
  const sourceDiscountValue = Number(data?.discountValue ?? draft.discountValue) || 0;
  const sourceAmountPaid = Number(data?.amountPaid ?? draft.amountPaid) || 0;
  const sourceCustomerName = data?.customerName ?? draft.customerName;
  const sourceCustomerPhone = data?.customerPhone ?? draft.customerPhone;
  const sourceShippingAddress = data?.shippingAddress ?? draft.shippingAddress;
  const sourceTaxRate = Number(data?.taxRate ?? settings.taxRate) || 0;
  const sourceVatRate = Number(data?.vatRate ?? settings.vatRate) || 0;
  const sourceServiceRate = Number(data?.serviceRate ?? settings.serviceRate) || 0;
  const sourceCurrency = data?.currency ?? settings.currency;
  const sym = currencySymbol(sourceCurrency);

  const subtotal = sourceLines.reduce((sum: number, line: ReceiptLine) => sum + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0);
  const discount = sourceDiscountMode === "percentage" ? subtotal * (sourceDiscountValue / 100) : sourceDiscountValue;
  const base = Math.max(0, subtotal - discount);
  const tax = base * (sourceTaxRate / 100);
  const vat = base * (sourceVatRate / 100);
  const service = base * (sourceServiceRate / 100);
  const total = base + tax + vat + service;
  const change = Math.max(0, sourceAmountPaid - total);

  const orderNum = order?.orderNumber ?? "—";
  const dateStr = order?.dateLabel ?? new Date().toLocaleString();

  return (
    <View style={styles.container}>
      {/* Professional Receipt Paper Container */}
      <View style={styles.paper}>
        {/* Header Branding */}
        <View style={styles.header}>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>OFFICIAL RECEIPT</Text>
            </View>
          </View>
          <Text style={styles.storeName}>{store?.name ?? settings.shopName ?? "OmniPOS Store"}</Text>
          <Text style={styles.orderNumber}>Order #{orderNum}</Text>
          <Text style={styles.timestamp}>{dateStr}</Text>
        </View>

        <View style={styles.dashedDivider} />

        {/* Itemized Table */}
        <View style={styles.itemsSection}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderLeft}>ITEM & QTY</Text>
            <Text style={styles.tableHeaderRight}>AMOUNT</Text>
          </View>

          {sourceLines.map((line, idx) => {
            const lineTotal = (Number(line.price) || 0) * (Number(line.quantity) || 0);
            return (
              <View key={line.id || `line-${idx}`} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{line.name}</Text>
                  <Text style={styles.itemSub}>
                    {line.quantity} × {sym}{(Number(line.price) || 0).toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>
                  {sym}{lineTotal.toFixed(2)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.solidDivider} />

        {/* Calculations Breakdown */}
        <View style={styles.summarySection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{sym}{subtotal.toFixed(2)}</Text>
          </View>

          {discount > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: Colors.accentOrange }]}>
                Discount {sourceDiscountMode === "percentage" ? `(${sourceDiscountValue}%)` : ""}
              </Text>
              <Text style={[styles.summaryValue, { color: Colors.accentOrange, fontWeight: "700" }]}>
                -{sym}{discount.toFixed(2)}
              </Text>
            </View>
          ) : null}

          {tax > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tax ({sourceTaxRate}%)</Text>
              <Text style={styles.summaryValue}>{sym}{tax.toFixed(2)}</Text>
            </View>
          ) : null}

          {vat > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>VAT ({sourceVatRate}%)</Text>
              <Text style={styles.summaryValue}>{sym}{vat.toFixed(2)}</Text>
            </View>
          ) : null}

          {service > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service Charge ({sourceServiceRate}%)</Text>
              <Text style={styles.summaryValue}>{sym}{service.toFixed(2)}</Text>
            </View>
          ) : null}
        </View>

        {/* Grand Total Block */}
        <View style={styles.grandTotalBlock}>
          <Text style={styles.grandTotalLabel}>TOTAL DUE</Text>
          <Text style={styles.grandTotalValue}>{sym}{total.toFixed(2)}</Text>
        </View>

        {/* Payment & Change Details */}
        <View style={styles.paymentBox}>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Amount Tendered</Text>
            <Text style={styles.paymentValue}>{sym}{sourceAmountPaid.toFixed(2)}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Change Returned</Text>
            <Text style={[styles.paymentValue, { color: Colors.success }]}>{sym}{change.toFixed(2)}</Text>
          </View>
        </View>

        {/* Customer Information (if present) */}
        {sourceCustomerName || sourceCustomerPhone || sourceShippingAddress ? (
          <View style={styles.customerBox}>
            <Text style={styles.customerTitle}>Customer Details</Text>
            {sourceCustomerName ? (
              <Text style={styles.customerText}>Name: {sourceCustomerName}</Text>
            ) : null}
            {sourceCustomerPhone ? (
              <Text style={styles.customerText}>Phone: {sourceCustomerPhone}</Text>
            ) : null}
            {sourceShippingAddress ? (
              <Text style={styles.customerText}>Address: {sourceShippingAddress}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.dashedDivider} />

        {/* Barcode & Footer */}
        <BarcodeVisual code={orderNum} />
        <Text style={styles.barcodeRef}>*{orderNum}*</Text>

        <View style={styles.footer}>
          <Text style={styles.footerThanks}>Thank you for your patronage!</Text>
          <Text style={styles.footerBrand}>Powered by OmniPOS</Text>
        </View>
      </View>

      {/* Floating / Bottom Icon Actions */}
      <View style={styles.iconActionBar}>
        {/* Print Icon Action */}
        <Pressable
          style={({ pressed }) => [
            styles.iconActionButton,
            styles.printActionButton,
            !connected && styles.printActionDisabled,
            pressed && styles.iconButtonPressed,
          ]}
          onPress={() => onPrint?.()}
          disabled={!connected}
        >
          <View style={[styles.iconCircle, { backgroundColor: connected ? "#e0e7ff" : "#f1f5f9" }]}>
            <Ionicons
              name="print"
              size={22}
              color={connected ? Colors.primaryBlue : Colors.textMuted}
            />
          </View>
          <View style={styles.actionTextWrap}>
            <Text style={[styles.actionTitle, !connected && { color: Colors.textMuted }]}>
              Print Receipt
            </Text>
            <Text style={[styles.actionSubtitle, connected ? styles.statusOnline : styles.statusOffline]}>
              {connected ? `Connected (${deviceName ?? "Printer"})` : "Printer offline (Settings)"}
            </Text>
          </View>
        </Pressable>

        {/* Share PDF Icon Action */}
        <Pressable
          style={({ pressed }) => [
            styles.iconActionButton,
            styles.shareActionButton,
            pressed && styles.iconButtonPressed,
          ]}
          onPress={() => onShare?.()}
        >
          <View style={[styles.iconCircle, { backgroundColor: "#dcfce7" }]}>
            <Ionicons name="share-social" size={22} color="#16a34a" />
          </View>
          <View style={styles.actionTextWrap}>
            <Text style={[styles.actionTitle, { color: "#15803d" }]}>Share PDF</Text>
            <Text style={styles.actionSubtitle}>Export professional PDF</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  paper: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: Spacing.lg,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  badgeRow: {
    marginBottom: Spacing.xs,
  },
  badge: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.primaryBlue,
    letterSpacing: 0.8,
  },
  storeName: {
    ...Typography.title,
    fontSize: 22,
    fontWeight: "900",
    color: Colors.textPrimary,
    textTransform: "uppercase",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.primaryBlue,
    marginTop: 2,
  },
  timestamp: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  dashedDivider: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderStyle: "dashed",
    marginVertical: Spacing.md,
  },
  solidDivider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: Spacing.sm,
  },
  itemsSection: {
    gap: Spacing.xs,
  },
  tableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  tableHeaderLeft: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.5,
  },
  tableHeaderRight: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  itemInfo: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  summarySection: {
    gap: 6,
    paddingVertical: Spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  grandTotalBlock: {
    backgroundColor: "#0f172a",
    borderRadius: Radius.input,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: Spacing.sm,
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#cbd5e1",
    letterSpacing: 0.5,
  },
  grandTotalValue: {
    fontSize: 22,
    fontWeight: "900",
    color: "#ffffff",
  },
  paymentBox: {
    backgroundColor: "#f8fafc",
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 4,
    marginVertical: Spacing.xs,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  paymentValue: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  customerBox: {
    backgroundColor: "#f8fafc",
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    gap: 2,
    marginTop: Spacing.xs,
  },
  customerTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  customerText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  barcodeWrap: {
    alignItems: "center",
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  barcodeBars: {
    flexDirection: "row",
    alignItems: "stretch",
    width: "85%",
    maxWidth: 260,
    height: 42,
  },
  bar: {
    height: "100%",
    backgroundColor: "#0f172a",
    borderRadius: 1,
  },
  barcodeRef: {
    textAlign: "center",
    fontFamily: "monospace",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
    marginTop: 4,
  },
  footer: {
    alignItems: "center",
    marginTop: Spacing.sm,
    gap: 2,
  },
  footerThanks: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  footerBrand: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  iconActionBar: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  iconActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  printActionButton: {
    backgroundColor: Colors.surface,
    borderColor: "#c7d2fe",
  },
  printActionDisabled: {
    opacity: 0.7,
    borderColor: "#e2e8f0",
  },
  shareActionButton: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  statusOnline: {
    color: Colors.primaryBlue,
    fontWeight: "600",
  },
  statusOffline: {
    color: Colors.accentOrange,
  },
  iconButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
