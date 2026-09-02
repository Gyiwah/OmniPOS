import { EscPos } from "./escpos";

/**
 * A sale, as a printed receipt.
 *
 * Every figure comes from the sale as it was booked, and none is recomputed.
 * The previous build derived subtotal, tax and total from the store's *current*
 * rates, so a receipt reprinted after a VAT change printed the new rate applied
 * to an old sale — and rounding could differ from what the customer actually
 * paid. A receipt has to say what was charged.
 *
 * Deliberately identical in shape to the web client's, so a shop with a phone
 * and a browser till hands out the same document from both.
 */

export type ReceiptLine = {
  name: string;
  quantity: number;
  /** Line total as charged, in major units. */
  lineTotal: number;
};

export type ReceiptTender = {
  method: string;
  amount: number;
};

/** The sale as booked. Every figure here was stored, not derived. */
export type PrintableReceipt = {
  orderNumber: string;
  dateLabel: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  changeDue: number;
  tenders: ReceiptTender[];
  customerName?: string | null;
  /** True while the sale is still in the outbox. */
  pending?: boolean;
  voided?: boolean;
};

export type ReceiptContext = {
  storeName: string;
  storeEmail?: string | null;
  currency: string;
  cashierName?: string | null;
  width: 58 | 80;
  reprint?: boolean;
  openDrawer?: boolean;
};

/**
 * Both spellings are here on purpose. The picker on this device stores 'momo';
 * the server, and anything that came back from it, says 'mobile_money'. A
 * receipt printed from a local record and one printed from a synced record are
 * the same sale, and must read the same.
 */
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  momo: "Mobile money",
  mobile_money: "Mobile money",
  store_credit: "Store credit",
  loyalty: "Loyalty",
  other: "Other",
};

/**
 * The currency code, not a symbol.
 *
 * The cedi (U+20B5) and the naira (U+20A6) are in no printer code page, and a
 * thermal printer given a character it has no glyph for prints "?" — so every
 * line of a Ghanaian receipt read "?16.00". Only the dollar happens to survive,
 * which is the worst kind of bug: correct on the one currency a developer is
 * most likely to test with.
 *
 * The code is unambiguous, prints anywhere, and matches the web till exactly.
 */
function symbol(currency: string): string {
  return `${currency} `;
}

export function buildReceipt(receipt: PrintableReceipt, context: ReceiptContext): Uint8Array {
  const sym = symbol(context.currency);
  const money = (value: number) => `${sym}${value.toFixed(2)}`;

  const p = new EscPos(context.width).init().codepage();

  /*
   * Before anything prints, so the drawer is open by the time the cashier has
   * torn the receipt off. Never on a reprint: reprinting a morning's receipts
   * would have the drawer springing open on each one.
   */
  if (context.openDrawer && !context.reprint) p.openDrawer();

  p.align("center").size(2, 2).bold(true).line(context.storeName).size(1, 1).bold(false);

  if (context.storeEmail) p.line(context.storeEmail);

  p.feed(1).line(receipt.orderNumber).line(receipt.dateLabel);

  if (context.cashierName) p.line(`Served by ${context.cashierName}`);

  /*
   * A reprint says so. Two identical receipts for one sale is how a refund gets
   * processed twice, and it is always the second one that gets presented.
   */
  if (context.reprint) p.feed(1).bold(true).line("** REPRINT **").bold(false);

  p.align("left").rule();

  for (const line of receipt.lines) {
    p.itemRow(line.name, line.quantity, money(line.lineTotal));
  }

  p.rule().columnsRow("Subtotal", money(receipt.subtotal));

  if (receipt.discount > 0) p.columnsRow("Discount", `-${money(receipt.discount)}`);
  if (receipt.tax > 0) p.columnsRow("Tax", money(receipt.tax));

  p.bold(true).size(1, 2).columnsRow("TOTAL", money(receipt.total)).size(1, 1).bold(false);

  p.feed(1);

  for (const tender of receipt.tenders) {
    p.columnsRow(METHOD_LABELS[tender.method] ?? tender.method, money(tender.amount));
  }

  if (receipt.changeDue > 0) p.columnsRow("Change", money(receipt.changeDue));

  const owed = Math.round((receipt.total - receipt.amountPaid) * 100) / 100;
  if (owed > 0) {
    p.feed(1).bold(true).columnsRow("BALANCE ON ACCOUNT", money(owed)).bold(false);
    if (receipt.customerName) p.line(receipt.customerName);
  }

  /*
   * On the paper, not only on screen. A cashier handing this over during an
   * outage should be able to see the sale has not reached the books, and so
   * should whoever reconciles it later.
   */
  if (receipt.pending) {
    p.feed(1).align("center").line("Recorded offline - awaiting sync").align("left");
  }

  if (receipt.voided) {
    p.feed(1).align("center").bold(true).line("** VOIDED **").bold(false).align("left");
  }

  p.feed(1).align("center").barcode(receipt.orderNumber).feed(1).line("Thank you").align("left");

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

  // The width is the thing being checked: if this ruler does not end flush with
  // the rules above and below it, the paper setting is wrong.
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
