import type { LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { EscPos } from "./escpos";

/**
 * A sale, as a printed receipt.
 *
 * Every figure comes from the stored order and none is recomputed. The order
 * already holds the subtotal, discount, tax and total that were charged, and
 * re-deriving them from the store's current rates would print a receipt that
 * disagrees with the books the moment a rate changes — or by a penny, whenever
 * rounding falls differently. The customer's copy has to say what they paid.
 */

export type ReceiptContext = {
  storeName: string;
  storeEmail?: string | null;
  currency: string;
  cashierName?: string | null;
  /** 58mm or 80mm paper. */
  width: 58 | 80;
  /** Printed on a reprint so a duplicate is never mistaken for a second sale. */
  reprint?: boolean;
  /**
   * Kick the drawer open. Only meaningful when the till's drawer is wired to
   * the printer, which is how most are built — nothing else can open one.
   */
  openDrawer?: boolean;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
  store_credit: "Store credit",
  loyalty: "Loyalty",
  other: "Other",
};

export function buildReceipt(order: LocalOrder, context: ReceiptContext): Uint8Array {
  const money = (value: string | number) =>
    formatMoney(typeof value === "number" ? value : toMinor(value), context.currency);

  const p = new EscPos(context.width).init().codepage();

  /*
   * Before anything prints, so the drawer is open by the time the cashier has
   * torn the receipt off. Never on a reprint: reprinting a morning's receipts
   * would have the drawer springing open on each one.
   */
  if (context.openDrawer && !context.reprint) p.openDrawer();

  // ---- who and when ----
  p.align("center").bold(true).line("OFFICIAL RECEIPT").size(2, 2).line(context.storeName).size(1, 1).bold(false);

  if (context.storeEmail) p.line(context.storeEmail);

  p.feed(1)
    .bold(true).line(`Order #${order.order_number}`).bold(false)
    .line(new Date(order.client_created_at).toLocaleString());

  if (context.cashierName) p.line(`Served by ${context.cashierName}`);
  p.line(`Currency: ${context.currency}`);

  /*
   * A reprint says so, prominently. Two identical receipts for one sale is how
   * a refund gets processed twice, and the second one is the one that gets
   * presented.
   */
  if (context.reprint) p.feed(1).bold(true).line("** REPRINT **").bold(false);

  p.align("left").rule().bold(true).line("ITEM & QTY".padEnd(Math.max(0, p.columns - 6)) + "AMOUNT").bold(false);

  // ---- what was bought ----
  for (const item of order.items) {
    p.itemRow(item.product_name, item.quantity, money(item.line_total));
  }

  p.rule();

  // ---- what it came to ----
  p.columnsRow("Subtotal", money(order.subtotal));

  if (toMinor(order.discount) > 0) p.columnsRow("Discount", `-${money(order.discount)}`);
  if (toMinor(order.tax) > 0) p.columnsRow("Tax", money(order.tax));

  p.bold(true).size(1, 2).columnsRow("TOTAL DUE", money(order.total)).size(1, 1).bold(false);

  // ---- how it was paid ----
  p.feed(1);

  p.columnsRow("Amount Tendered", money(order.amount_paid));
  p.columnsRow("Change Returned", money(order.change_due));

  for (const payment of order.payments) {
    p.columnsRow(METHOD_LABELS[payment.method] ?? payment.method, money(payment.amount));
  }

  if (toMinor(order.change_due) > 0) p.columnsRow("Change", money(order.change_due));

  const owed = toMinor(order.total) - toMinor(order.amount_paid);
  if (owed > 0) {
    p.feed(1).bold(true).columnsRow("BALANCE ON ACCOUNT", money(owed)).bold(false);
    if (order.customer_name) p.line(`Name: ${order.customer_name}`);
  }

  if (order.customer_phone) p.line(`Phone: ${order.customer_phone}`);

  /*
   * Printed on the paper, not only shown on screen. A cashier handing this over
   * during an outage should be able to see the sale has not reached the books,
   * and so should whoever reconciles it later.
   */
  if (order._state === "pending") {
    p.feed(1).align("center").line("Recorded offline - awaiting sync").align("left");
  }

  if (order._state === "conflict" || order.status === "voided") {
    p.feed(1)
      .align("center")
      .bold(true)
      .line(order.status === "voided" ? "** VOIDED **" : "** NOT ON THE BOOKS **")
      .bold(false)
      .align("left");
  }

  // ---- the bit a returns desk scans ----
  p.feed(1)
    .align("center")
    .barcode(order.order_number)
    .line(`*${order.order_number}*`)
    .feed(1)
    .bold(true)
    .line("Thank you for your patronage!")
    .bold(false)
    .line("Powered by OmniPOS")
    .align("left");

  return p.cut().toBytes();
}

/** A short job to prove a printer is connected and configured correctly. */
export function buildTestPrint(context: Pick<ReceiptContext, "storeName" | "width">): Uint8Array {
  const p = new EscPos(context.width).init().codepage();

  p.align("center").size(2, 2).bold(true).line("OmniPOS").size(1, 1).bold(false)
    .line(context.storeName)
    .line(new Date().toLocaleString())
    .align("left")
    .rule();

  // The width is the thing being checked: if the rule above wrapped, or this
  // ruler does not end flush, the paper setting is wrong.
  p.line(`Paper: ${context.width}mm, ${p.columns} characters`);
  p.line("1234567890".repeat(Math.ceil(p.columns / 10)).slice(0, p.columns));

  p.rule()
    .columnsRow("Left", "Right")
    .itemRow("A product with a deliberately long name to check wrapping", 2, "199.99")
    .rule()
    .align("center")
    .line("If this looks right, printing works.");

  return p.cut().toBytes();
}
