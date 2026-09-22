/**
 * ESC/POS, as bytes.
 *
 * Thermal printers do not take HTML. They take a byte stream of text
 * interleaved with escape sequences, and every one of those sequences is
 * specified — which is why this is worth writing rather than delegating to a
 * library whose job format is its own invention.
 *
 * The practical benefit is that it can be tested. A receipt is a legal document
 * in most of the places this runs, and "it looked right on the one printer we
 * had" is not a test. Every function here returns bytes, and the tests assert
 * the bytes.
 *
 * Command reference: Epson ESC/POS, which every cheap 58mm and 80mm printer
 * implements some subset of. Where a printer ignores a command it prints the
 * text anyway, so the receipt degrades rather than failing.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Align = "left" | "center" | "right";

/** Characters per line at Font A. The two paper widths a shop actually buys. */
export const CHARS_PER_LINE: Record<58 | 80, number> = { 58: 32, 80: 48 };

/**
 * Builds a byte stream.
 *
 * Mutable and chainable on purpose: a receipt is written top to bottom, once,
 * and an immutable builder would allocate a copy per line for no benefit.
 */
export class EscPos {
  private readonly chunks: number[] = [];

  constructor(public readonly width: 58 | 80 = 80) {}

  get columns(): number {
    return CHARS_PER_LINE[this.width];
  }

  raw(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  /**
   * ESC @ — reset.
   *
   * Sent first, always. A printer holds its state across jobs, so a receipt
   * that followed one ending in double-height would otherwise print its header
   * twice the size for reasons nobody could see in the code.
   */
  init(): this {
    return this.raw(ESC, 0x40);
  }

  /**
   * ESC t — code page.
   *
   * 16 is WPC1252, which carries the accented characters and the £ sign. Cheap
   * printers vary in what they support; where this is wrong the text still
   * prints, with the wrong glyph for anything outside ASCII.
   */
  codepage(page = 16): this {
    return this.raw(ESC, 0x74, page);
  }

  align(align: Align): this {
    const value = align === "center" ? 1 : align === "right" ? 2 : 0;
    return this.raw(ESC, 0x61, value);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  underline(on: boolean): this {
    return this.raw(ESC, 0x2d, on ? 1 : 0);
  }

  /**
   * GS ! — character size, as a 4-bit width and 4-bit height multiplier.
   *
   * Clamped rather than trusted: a value above 8 sets bits the command does not
   * define, and printers respond to that by garbling the rest of the line.
   */
  size(width: number, height: number): this {
    const w = Math.min(Math.max(Math.trunc(width), 1), 8) - 1;
    const h = Math.min(Math.max(Math.trunc(height), 1), 8) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  text(value: string): this {
    return this.raw(...encode(value));
  }

  line(value = ""): this {
    return this.text(value).raw(LF);
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.min(Math.max(lines, 0), 255));
  }

  /** A rule across the paper, in the width this printer actually has. */
  rule(char = "-"): this {
    return this.line(char.repeat(this.columns));
  }

  /**
   * A label on the left and a figure on the right, filled to the paper width.
   *
   * The one thing a receipt must get right typographically: if the figure does
   * not end at the right margin, every total on the receipt looks ragged and a
   * customer cannot scan down the column.
   *
   * A label too long to fit is truncated, not wrapped — wrapping would push the
   * figure onto its own line and break that column.
   */
  columnsRow(left: string, right: string): this {
    const room = this.columns - right.length - 1;

    if (room <= 0) {
      // The figure alone fills the line. Print it right-aligned on its own
      // rather than emitting a line longer than the paper, which wraps.
      return this.line(right.slice(-this.columns).padStart(this.columns));
    }

    const label = left.length > room ? `${left.slice(0, room - 1)}…` : left;

    return this.line(label.padEnd(this.columns - right.length) + right);
  }

  /**
   * A sale line: quantity and name on the left, money on the right.
   *
   * The name wraps onto continuation lines rather than being cut, because a
   * shopper checks a receipt by reading the names — but the money stays on the
   * first line so the column still scans.
   */
  itemRow(name: string, quantity: number, amount: string): this {
    const prefix = `${quantity} x `;
    const room = this.columns - amount.length - 1;
    const available = room - prefix.length;

    if (available <= 4) {
      return this.columnsRow(`${prefix}${name}`, amount);
    }

    const words = name.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= available) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);

      /*
       * A word with nowhere to break is cut into as many pieces as it takes.
       * Splitting once was not enough: a sixty-character word against a
       * twenty-character line left a thirty-nine-character remainder that
       * nothing split again, and it printed off the edge of the paper.
       */
      let rest = word;
      while (rest.length > available) {
        lines.push(rest.slice(0, available));
        rest = rest.slice(available);
      }
      current = rest;
    }
    if (current) lines.push(current);
    if (lines.length === 0) lines.push("");

    this.columnsRow(`${prefix}${lines[0]}`, amount);

    // Continuations are indented under the name, not under the quantity.
    for (const rest of lines.slice(1)) {
      this.line(" ".repeat(prefix.length) + rest);
    }

    return this;
  }

  /**
   * GS k — a barcode, for a receipt number someone will scan at a returns desk.
   *
   * CODE39 rather than the retail symbologies: it accepts letters, which
   * OM-20260902-0007 needs, and every printer that does barcodes does this one.
   * Characters outside its alphabet are dropped rather than sent — a printer
   * given an invalid character prints nothing at all and swallows the rest of
   * the job with it.
   */
  barcode(value: string, height = 60): this {
    const cleaned = value.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, "");
    if (!cleaned) return this;

    const bytes = encode(cleaned);

    return this
      .raw(GS, 0x68, Math.min(Math.max(height, 1), 255)) // height
      .raw(GS, 0x77, 2) // module width
      .raw(GS, 0x48, 2) // print the digits underneath
      .raw(GS, 0x6b, 4, ...bytes, 0x00); // CODE39, NUL-terminated
  }

  /** GS V — cut. Partial by default: a full cut drops the receipt on the floor. */
  cut(partial = true): this {
    // Feed first. The blade sits above the print head, so cutting immediately
    // slices through the last few lines.
    return this.feed(4).raw(GS, 0x56, partial ? 1 : 0);
  }

  /**
   * ESC p — open the cash drawer.
   *
   * The drawer is wired to the printer, not to the computer, so this is the
   * only way to open one. Pin 0 is the near-universal wiring; pin 1 exists for
   * the tills that are not.
   */
  openDrawer(pin: 0 | 1 = 0): this {
    return this.raw(ESC, 0x70, pin, 25, 250);
  }

  /**
   * Standardized Store Receipt Header
   */
  receiptHeader(storeName: string, address?: string, phone?: string): this {
    this.init().codepage(16);
    this.align("center").bold(true).size(2, 2).line(storeName).size(1, 1).bold(false);
    if (address) this.line(address);
    if (phone) this.line(`Tel: ${phone}`);
    return this.rule("=");
  }

  /**
   * Standardized Receipt Footer
   */
  receiptFooter(thankYouMessage = "Thank you for shopping with us!", returnPolicy?: string): this {
    this.rule("-").align("center");
    this.line(thankYouMessage);
    if (returnPolicy) this.line(returnPolicy);
    return this.feed(2);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/**
 * Text to bytes, in a single-byte encoding.
 *
 * Deliberately not TextEncoder: that produces UTF-8, and a thermal printer
 * reading UTF-8 as a single-byte code page renders every accented character as
 * two pieces of line noise. Anything outside the page becomes '?', which is
 * legible and wrong, rather than bytes that are neither.
 */
export function encode(value: string): number[] {
  const out: number[] = [];

  for (const char of value.replace(/\r\n?/g, "\n")) {
    const code = char.codePointAt(0) ?? 63;

    if (code < 0x80) {
      out.push(code);
      continue;
    }

    const mapped = WPC1252[char];
    out.push(mapped ?? 0x3f);
  }

  return out;
}

/**
 * The characters worth mapping beyond ASCII.
 *
 * Not the whole of WPC1252 — just what actually reaches a receipt: currency
 * marks, the accented letters common in the languages this runs in, and the
 * typographic quotes and dashes that word processors insert into store names
 * without anybody noticing.
 */
const WPC1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "•": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
  "\u00a0": 0x20, "¡": 0xa1, "¢": 0xa2, "£": 0xa3, "¤": 0xa4, "¥": 0xa5,
  "§": 0xa7, "©": 0xa9, "«": 0xab, "®": 0xae, "°": 0xb0, "±": 0xb1,
  "µ": 0xb5, "¶": 0xb6, "·": 0xb7, "»": 0xbb, "¿": 0xbf,
  "À": 0xc0, "Á": 0xc1, "Â": 0xc2, "Ã": 0xc3, "Ä": 0xc4, "Å": 0xc5, "Æ": 0xc6,
  "Ç": 0xc7, "È": 0xc8, "É": 0xc9, "Ê": 0xca, "Ë": 0xcb, "Ì": 0xcc, "Í": 0xcd,
  "Î": 0xce, "Ï": 0xcf, "Ñ": 0xd1, "Ò": 0xd2, "Ó": 0xd3, "Ô": 0xd4, "Õ": 0xd5,
  "Ö": 0xd6, "Ø": 0xd8, "Ù": 0xd9, "Ú": 0xda, "Û": 0xdb, "Ü": 0xdc, "ß": 0xdf,
  "à": 0xe0, "á": 0xe1, "â": 0xe2, "ã": 0xe3, "ä": 0xe4, "å": 0xe5, "æ": 0xe6,
  "ç": 0xe7, "è": 0xe8, "é": 0xe9, "ê": 0xea, "ë": 0xeb, "ì": 0xec, "í": 0xed,
  "î": 0xee, "ï": 0xef, "ñ": 0xf1, "ò": 0xf2, "ó": 0xf3, "ô": 0xf4, "õ": 0xf5,
  "ö": 0xf6, "ø": 0xf8, "ù": 0xf9, "ú": 0xfa, "û": 0xfb, "ü": 0xfc, "ÿ": 0xff,
};
