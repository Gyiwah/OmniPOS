import { CHARS_PER_LINE, EscPos, encode } from "@/src/core/printing/escpos";
import {
  buildReceipt,
  buildTestPrint,
  type PrintableReceipt,
} from "@/src/core/printing/receipt";

/**
 * ESC/POS is a specification, so it can be asserted rather than eyeballed.
 *
 * "It looked right on the one printer we had" is not a test, and a receipt is a
 * document a customer keeps. Everything here checks the actual bytes.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** The printed text, with the escape sequences stripped, for readability checks. */
function printedLines(bytes: Uint8Array): string[] {
  const text: number[] = [];

  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];

    // Skip the commands this builder emits, so what is left is what prints.
    if (b === ESC) {
      const cmd = bytes[i + 1];
      i += cmd === 0x40 ? 1 : cmd === 0x70 ? 4 : 2;
      continue;
    }
    if (b === GS) {
      const cmd = bytes[i + 1];
      if (cmd === 0x6b) {
        // Barcode: skip to its terminating NUL.
        while (i < bytes.length && bytes[i] !== 0x00) i += 1;
        continue;
      }
      i += 2;
      continue;
    }
    text.push(b);
  }

  /*
   * Decoded as cp1252, not latin1. The two differ across 0x80–0x9F, which is
   * exactly where the ellipsis and the currency marks live — decoding as latin1
   * rendered them as control characters and made a correct receipt look wrong.
   */
  return Buffer.from(text)
    .toString("latin1")
    .replace(/[\u0080-\u009f]/g, (c) => CP1252_HIGH[c.charCodeAt(0)] ?? c)
    .split("\n");
}

const CP1252_HIGH: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x91: "'", 0x92: "'", 0x93: "“", 0x94: "”", 0x95: "•",
  0x96: "–", 0x97: "—", 0x99: "™",
};

describe("the byte stream", () => {
  /**
   * A printer holds its state across jobs. Without a reset, a receipt following
   * one that ended in double-height prints its header twice the size, for
   * reasons invisible in the code.
   */
  it("starts with a reset", () => {
    const bytes = new EscPos(80).init().toBytes();
    expect([...bytes]).toEqual([ESC, 0x40]);
  });

  it("emits the documented alignment codes", () => {
    expect([...new EscPos().align("left").toBytes()]).toEqual([ESC, 0x61, 0]);
    expect([...new EscPos().align("center").toBytes()]).toEqual([ESC, 0x61, 1]);
    expect([...new EscPos().align("right").toBytes()]).toEqual([ESC, 0x61, 2]);
  });

  it("packs character size into one nibble each, zero-based", () => {
    // GS ! n, where the high nibble is width-1 and the low nibble height-1.
    expect([...new EscPos().size(1, 1).toBytes()]).toEqual([GS, 0x21, 0x00]);
    expect([...new EscPos().size(2, 2).toBytes()]).toEqual([GS, 0x21, 0x11]);
    expect([...new EscPos().size(1, 2).toBytes()]).toEqual([GS, 0x21, 0x01]);
  });

  /**
   * A multiplier above 8 sets bits the command does not define, and printers
   * respond by garbling the rest of the line rather than ignoring it.
   */
  it("clamps a size a printer would choke on", () => {
    expect([...new EscPos().size(99, 0).toBytes()]).toEqual([GS, 0x21, 0x70]);
  });

  it("feeds before cutting", () => {
    const bytes = [...new EscPos().cut().toBytes()];

    // The blade sits above the head; cutting immediately slices the last lines.
    expect(bytes.slice(0, 3)).toEqual([ESC, 0x64, 4]);
    expect(bytes.slice(3)).toEqual([GS, 0x56, 1]);
  });

  it("opens the drawer through the printer, because that is how it is wired", () => {
    expect([...new EscPos().openDrawer().toBytes()]).toEqual([ESC, 0x70, 0, 25, 250]);
  });
});

describe("text encoding", () => {
  /**
   * NOT TextEncoder. That produces UTF-8, and a printer reading UTF-8 as a
   * single-byte code page renders every accented character as two pieces of
   * line noise.
   */
  it("encodes a currency symbol as one byte, not as UTF-8", () => {
    expect(encode("£")).toEqual([0xa3]);
    expect(encode("€")).toEqual([0x80]);
    expect(new TextEncoder().encode("£")).toHaveLength(2);
  });

  it("keeps ASCII as itself", () => {
    expect(encode("OM-1")).toEqual([0x4f, 0x4d, 0x2d, 0x31]);
  });

  it("carries the accented letters a shop name actually contains", () => {
    expect(encode("Café")).toEqual([0x43, 0x61, 0x66, 0xe9]);
  });

  /** Legible and wrong beats bytes that are neither. */
  it("substitutes a question mark for anything it cannot represent", () => {
    expect(encode("日")).toEqual([0x3f]);
  });

  /**
   * A word processor turns a straight quote into a curly one, so a store name
   * typed into Word arrives with U+2019 in it. These were once written into the
   * code page map as plain apostrophes, which made two entries share a key and
   * silently dropped one — caught by the compiler, but only because they
   * collided. The escapes exist so an editor cannot flatten them again.
   */
  it("maps the typographic quotes a store name picks up from a word processor", () => {
    expect(encode("‘")).toEqual([0x91]);
    expect(encode("’")).toEqual([0x92]);
    expect(encode("“")).toEqual([0x93]);
    expect(encode("”")).toEqual([0x94]);
    expect(encode("–")).toEqual([0x96]);
    expect(encode("—")).toEqual([0x97]);
  });

  it("maps a non-breaking space to an ordinary one", () => {
    expect(encode(" ")).toEqual([0x20]);
  });

  it("normalises CRLF so a printer does not double-space", () => {
    expect(encode("a\r\nb")).toEqual([0x61, 0x0a, 0x62]);
  });
});

describe("laying out a line", () => {
  /**
   * The one thing a receipt must get right typographically. If figures do not
   * end at the right margin, a customer cannot scan down the column.
   */
  it("pushes the figure to the right margin", () => {
    const [line] = printedLines(new EscPos(58).columnsRow("Subtotal", "GHS 16.00").toBytes());

    expect(line).toHaveLength(CHARS_PER_LINE[58]);
    expect(line.endsWith("GHS 16.00")).toBe(true);
    expect(line.startsWith("Subtotal")).toBe(true);
  });

  it("uses the full width of 80mm paper", () => {
    const [line] = printedLines(new EscPos(80).columnsRow("Total", "1.00").toBytes());
    expect(line).toHaveLength(48);
  });

  /** Wrapping the label would push the figure onto its own line and break the column. */
  it("truncates a label too long to fit rather than wrapping it", () => {
    const [line] = printedLines(
      new EscPos(58).columnsRow("An extremely long label that cannot possibly fit", "9.99").toBytes(),
    );

    expect(line).toHaveLength(32);
    expect(line).toContain("…");
    expect(line.endsWith("9.99")).toBe(true);
  });

  it("never emits a line longer than the paper, even for a huge figure", () => {
    const lines = printedLines(new EscPos(58).columnsRow("x", "1234567890".repeat(5)).toBytes());
    for (const line of lines.filter(Boolean)) expect(line.length).toBeLessThanOrEqual(32);
  });
});

describe("a sale line", () => {
  it("puts the quantity and name left, the money right", () => {
    const [line] = printedLines(new EscPos(58).itemRow("Meat Pie", 2, "16.00").toBytes());

    expect(line).toContain("2 x Meat Pie");
    expect(line.endsWith("16.00")).toBe(true);
    expect(line).toHaveLength(32);
  });

  /**
   * A shopper checks a receipt by reading the names, so a long one wraps rather
   * than being cut — but the money stays on the first line so the column scans.
   */
  it("wraps a long name and keeps the money on the first line", () => {
    const lines = printedLines(
      new EscPos(58).itemRow("Organic wholemeal sliced bread loaf", 1, "15.00").toBytes(),
    ).filter(Boolean);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].endsWith("15.00")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);

    // Every word survives somewhere.
    const rejoined = lines.join(" ").replace(/\s+/g, " ");
    for (const word of ["Organic", "wholemeal", "sliced", "bread", "loaf"]) {
      expect(rejoined).toContain(word);
    }
  });

  it("indents the continuation under the name, not under the quantity", () => {
    const lines = printedLines(new EscPos(58).itemRow("A very long product name indeed here", 1, "1.00").toBytes());
    expect(lines[1].startsWith("    ")).toBe(true);
  });

  it("hard-splits a single word with nowhere to break", () => {
    const lines = printedLines(new EscPos(58).itemRow("A".repeat(60), 1, "1.00").toBytes()).filter(Boolean);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
  });
});

describe("the barcode", () => {
  /**
   * A printer given a character outside the symbology's alphabet prints nothing
   * and swallows the rest of the job with it — so the receipt disappears, not
   * just the barcode.
   */
  it("drops characters CODE39 cannot represent", () => {
    const bytes = [...new EscPos().barcode("om#2026/1").toBytes()];
    const start = bytes.indexOf(0x6b);
    const payload = bytes.slice(start + 2, bytes.indexOf(0x00, start));

    expect(Buffer.from(payload).toString("latin1")).toBe("OM2026/1");
  });

  it("emits nothing at all when nothing survives", () => {
    expect(new EscPos().barcode("###").toBytes()).toHaveLength(0);
  });

  it("prints a receipt number unchanged", () => {
    const bytes = [...new EscPos().barcode("OM-20260902-0007").toBytes()];
    const start = bytes.indexOf(0x6b);
    const payload = bytes.slice(start + 2, bytes.indexOf(0x00, start));

    expect(Buffer.from(payload).toString("latin1")).toBe("OM-20260902-0007");
  });
});

// ---------------------------------------------------------------- receipt

function order(over: Partial<PrintableReceipt> = {}): PrintableReceipt {
  return {
    orderNumber: "OM-20260902-0007",
    dateLabel: "2/9/2026, 9:15:00 AM",
    lines: [{ name: "Meat Pie", quantity: 2, lineTotal: 16 }],
    subtotal: 16,
    discount: 0,
    tax: 0,
    total: 16,
    amountPaid: 20,
    changeDue: 4,
    tenders: [{ method: "cash", amount: 16 }],
    customerName: null,
    ...over,
  };
}

const context = { storeName: "Accra Main", currency: "GHS", width: 80 as const };

describe("a printed receipt", () => {
  /**
   * The order already holds what was charged. Re-deriving it from the store's
   * current rates would print a receipt disagreeing with the books the moment a
   * rate changes, or by a penny whenever rounding falls differently.
   */
  it("prints the figures the sale was booked at, not recomputed ones", () => {
    const text = printedLines(buildReceipt(order({ total: 16, tax: 1.23 }), context)).join("\n");

    expect(text).toContain("GHS 16.00");
    expect(text).toContain("GHS 1.23");
  });

  it("shows the change without counting it as revenue", () => {
    const text = printedLines(buildReceipt(order(), context)).join("\n");

    expect(text).toContain("Change");
    expect(text).toContain("GHS 4.00");
    // Cash tendered is the 16 that was owed, not the 20 handed over.
    expect(text).toMatch(/Cash\s+GHS 16\.00/);
  });

  it("names the balance when a sale was left on account", () => {
    const text = printedLines(
      buildReceipt(order({ amountPaid: 6, changeDue: 0, customerName: "Ama Mensah" }), context),
    ).join("\n");

    expect(text).toContain("BALANCE ON ACCOUNT");
    expect(text).toContain("GHS 10.00");
    expect(text).toContain("Ama Mensah");
  });

  /**
   * On the paper, not only on screen. Whoever reconciles this later needs to
   * know the sale had not reached the books when it was handed over.
   */
  it("says on the paper when the sale has not reached the server", () => {
    const text = printedLines(buildReceipt(order({ pending: true }), context)).join("\n");
    expect(text).toContain("awaiting sync");
  });

  it("marks a voided sale", () => {
    const text = printedLines(buildReceipt(order({ voided: true }), context)).join("\n");
    expect(text).toContain("VOIDED");
  });

  /**
   * The picker on this device stores 'momo'; anything that has been to the
   * server and back says 'mobile_money'. They are the same sale, so they must
   * print the same word — and neither may fall through to the raw key, which
   * would put "momo" on a customer's receipt.
   */
  it.each(["momo", "mobile_money"])("names a mobile money tender given %s", (method) => {
    const text = printedLines(buildReceipt(order({ tenders: [{ method, amount: 16 }] }), context)).join("\n");

    expect(text).toMatch(/Mobile money\s+GHS 16\.00/);
  });

  /**
   * A method with no label prints as it is rather than as "Other". It is the
   * only honest option: an unrecognised tender is not the same as an
   * unidentified one, and a receipt should not claim to know less than it does.
   */
  it("prints an unlabelled method rather than hiding it", () => {
    const text = printedLines(
      buildReceipt(order({ tenders: [{ method: "voucher", amount: 16 }] }), context),
    ).join("\n");

    expect(text).toMatch(/voucher\s+GHS 16\.00/);
  });

  /** Two identical receipts is how a refund gets processed twice. */
  it("marks a reprint so a duplicate is not mistaken for a second sale", () => {
    const text = printedLines(buildReceipt(order(), { ...context, reprint: true })).join("\n");
    expect(text).toContain("REPRINT");
  });

  /**
   * The drawer is wired to the printer, so ESC p is the only way to open one.
   * Firing it on a reprint would have it springing open through a morning's
   * worth of duplicates.
   */
  it("kicks the drawer when asked, and never on a reprint", () => {
    const kicked = [...buildReceipt(order(), { ...context, openDrawer: true })];
    const reprint = [...buildReceipt(order(), { ...context, openDrawer: true, reprint: true })];

    const hasKick = (bytes: number[]) =>
      bytes.some((b, i) => b === ESC && bytes[i + 1] === 0x70 && bytes[i + 2] === 0 && bytes[i + 3] === 25);

    expect(hasKick(kicked)).toBe(true);
    expect(hasKick(reprint)).toBe(false);
  });

  it("leaves the drawer alone when the till is not wired for it", () => {
    const bytes = [...buildReceipt(order(), context)];
    expect(bytes.some((b, i) => b === ESC && bytes[i + 1] === 0x70)).toBe(false);
  });

  /**
   * The cedi and the naira are in no printer code page, so a printer given one
   * prints "?" — every line of a Ghanaian receipt read "?16.00". Only the
   * dollar survives, which is the worst kind of bug: correct on the currency a
   * developer is most likely to test with.
   */
  it("prints the currency code, because the symbol has no glyph", () => {
    const text = printedLines(buildReceipt(order(), { ...context, currency: "GHS" })).join("\n");

    expect(text).toContain("GHS 16.00");
    expect(text).not.toContain("?");
  });

  it("ends with a cut", () => {
    const bytes = buildReceipt(order(), context);
    expect([...bytes.slice(-3)]).toEqual([GS, 0x56, 1]);
  });

  it("respects the paper width throughout", () => {
    for (const width of [58, 80] as const) {
      const lines = printedLines(buildReceipt(order(), { ...context, width })).filter(Boolean);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(CHARS_PER_LINE[width]);
      }
    }
  });
});

describe("the test print", () => {
  /** Its whole job is to show whether the width setting is right. */
  it("prints a ruler exactly as wide as the paper", () => {
    const lines = printedLines(buildTestPrint({ storeName: "Accra Main", width: 58 })).filter(Boolean);
    const ruler = lines.find((l) => l.startsWith("1234567890"));

    expect(ruler).toBeDefined();
    expect(ruler).toHaveLength(32);
  });

  it("says which width it was told to use", () => {
    const text = printedLines(buildTestPrint({ storeName: "X", width: 80 })).join("\n");
    expect(text).toContain("Paper: 80mm, 48 characters");
  });
});
