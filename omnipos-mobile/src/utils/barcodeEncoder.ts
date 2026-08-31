/**
 * Standard Code 128 (Subset B) Barcode Encoder.
 * Produces accurate, hardware-scannable barcodes for physical scanners and camera readers.
 */

// Code 128 pattern table: each entry represents the 6 bar/space widths (sum = 11 modules)
const CODE128_PATTERNS: number[][] = [
  [2, 1, 2, 2, 2, 2], // 0: ' '
  [2, 2, 2, 1, 2, 2], // 1: '!'
  [2, 2, 2, 2, 2, 1], // 2: '"'
  [1, 2, 1, 2, 2, 3], // 3: '#'
  [1, 2, 1, 3, 2, 2], // 4: '$'
  [1, 3, 1, 2, 2, 2], // 5: '%'
  [1, 2, 2, 2, 1, 3], // 6: '&'
  [1, 2, 2, 3, 1, 2], // 7: '''
  [1, 3, 2, 2, 1, 2], // 8: '('
  [2, 2, 1, 2, 1, 3], // 9: ')'
  [2, 2, 1, 3, 1, 2], // 10: '*'
  [2, 3, 1, 2, 1, 2], // 11: '+'
  [1, 1, 2, 2, 3, 2], // 12: ','
  [1, 2, 2, 1, 3, 2], // 13: '-'
  [1, 2, 2, 2, 3, 1], // 14: '.'
  [1, 1, 3, 2, 2, 2], // 15: '/'
  [1, 2, 3, 1, 2, 2], // 16: '0'
  [1, 2, 3, 2, 2, 1], // 17: '1'
  [2, 2, 3, 2, 1, 1], // 18: '2'
  [2, 2, 1, 1, 3, 2], // 19: '3'
  [2, 2, 1, 2, 3, 1], // 20: '4'
  [2, 1, 3, 2, 1, 2], // 21: '5'
  [2, 2, 3, 1, 1, 2], // 22: '6'
  [3, 1, 2, 1, 3, 1], // 23: '7'
  [3, 1, 1, 2, 2, 2], // 24: '8'
  [3, 2, 1, 1, 2, 2], // 25: '9'
  [3, 2, 1, 2, 2, 1], // 26: ':'
  [3, 1, 2, 2, 1, 2], // 27: ';'
  [3, 2, 2, 1, 1, 2], // 28: '<'
  [3, 2, 2, 2, 1, 1], // 29: '='
  [2, 1, 2, 1, 2, 3], // 30: '>'
  [2, 1, 2, 3, 2, 1], // 31: '?'
  [2, 3, 2, 1, 2, 1], // 32: '@'
  [1, 1, 1, 3, 2, 3], // 33: 'A'
  [1, 3, 1, 1, 2, 3], // 34: 'B'
  [1, 3, 1, 3, 2, 1], // 35: 'C'
  [1, 1, 2, 3, 1, 3], // 36: 'D'
  [1, 3, 2, 1, 1, 3], // 37: 'E'
  [1, 3, 2, 3, 1, 1], // 38: 'F'
  [2, 1, 1, 3, 1, 3], // 39: 'G'
  [2, 3, 1, 1, 1, 3], // 40: 'H'
  [2, 3, 1, 3, 1, 1], // 41: 'I'
  [1, 1, 2, 1, 3, 3], // 42: 'J'
  [1, 1, 2, 3, 3, 1], // 43: 'K'
  [1, 3, 2, 1, 3, 1], // 44: 'L'
  [1, 1, 3, 1, 2, 3], // 45: 'M'
  [1, 1, 3, 3, 2, 1], // 46: 'N'
  [1, 3, 3, 1, 2, 1], // 47: 'O'
  [3, 1, 3, 1, 2, 1], // 48: 'P'
  [2, 1, 1, 3, 3, 1], // 49: 'Q'
  [2, 3, 1, 1, 3, 1], // 50: 'R'
  [2, 1, 3, 1, 1, 3], // 51: 'S'
  [2, 1, 3, 3, 1, 1], // 52: 'T'
  [2, 1, 3, 1, 3, 1], // 53: 'U'
  [3, 1, 1, 1, 2, 3], // 54: 'V'
  [3, 1, 1, 3, 2, 1], // 55: 'W'
  [3, 3, 1, 1, 2, 1], // 56: 'X'
  [3, 1, 2, 1, 1, 3], // 57: 'Y'
  [3, 1, 2, 3, 1, 1], // 58: 'Z'
  [3, 3, 2, 1, 1, 1], // 59: '['
  [3, 1, 4, 1, 1, 1], // 60: '\'
  [2, 2, 1, 4, 1, 1], // 61: ']'
  [4, 3, 1, 1, 1, 1], // 62: '^'
  [1, 1, 1, 2, 2, 4], // 63: '_'
  [1, 1, 1, 4, 2, 2], // 64: '`'
  [1, 2, 1, 1, 2, 4], // 65: 'a'
  [1, 2, 1, 4, 2, 1], // 66: 'b'
  [1, 4, 1, 1, 2, 2], // 67: 'c'
  [1, 4, 1, 2, 2, 1], // 68: 'd'
  [1, 1, 2, 2, 1, 4], // 69: 'e'
  [1, 1, 2, 4, 1, 2], // 70: 'f'
  [1, 2, 2, 1, 1, 4], // 71: 'g'
  [1, 2, 2, 4, 1, 1], // 72: 'h'
  [1, 4, 2, 1, 1, 2], // 73: 'i'
  [1, 4, 2, 2, 1, 1], // 74: 'j'
  [2, 4, 1, 2, 1, 1], // 75: 'k'
  [2, 2, 1, 1, 1, 4], // 76: 'l'
  [4, 1, 3, 1, 1, 1], // 77: 'm'
  [2, 4, 1, 1, 1, 2], // 78: 'n'
  [1, 3, 4, 1, 1, 1], // 79: 'o'
  [1, 1, 1, 2, 4, 2], // 80: 'p'
  [1, 2, 1, 1, 4, 2], // 81: 'q'
  [1, 2, 1, 2, 4, 1], // 82: 'r'
  [1, 1, 4, 2, 1, 2], // 83: 's'
  [1, 2, 4, 1, 1, 2], // 84: 't'
  [1, 2, 4, 2, 1, 1], // 85: 'u'
  [4, 1, 1, 2, 1, 2], // 86: 'v'
  [4, 2, 1, 1, 1, 2], // 87: 'w'
  [4, 2, 1, 2, 1, 1], // 88: 'x'
  [2, 1, 2, 1, 4, 1], // 89: 'y'
  [2, 1, 4, 1, 2, 1], // 90: 'z'
  [4, 1, 2, 1, 2, 1], // 91: '{'
  [1, 1, 1, 1, 4, 3], // 92: '|'
  [1, 1, 1, 3, 4, 1], // 93: '}'
  [1, 3, 1, 1, 4, 1], // 94: '~'
  [1, 1, 4, 1, 1, 3], // 95: DEL
  [1, 1, 4, 3, 1, 1], // 96: FNC 3
  [4, 1, 1, 1, 1, 3], // 97: FNC 2
  [4, 1, 1, 3, 1, 1], // 98: SHIFT
  [1, 1, 3, 1, 4, 1], // 99: CODE C
  [1, 1, 4, 1, 3, 1], // 100: CODE B
  [3, 1, 1, 1, 4, 1], // 101: FNC 4
  [4, 1, 1, 1, 3, 1], // 102: FNC 1
  [2, 1, 1, 4, 1, 2], // 103: Start A
  [2, 1, 1, 2, 1, 4], // 104: Start B
  [2, 1, 1, 2, 3, 2], // 105: Start C
];

const STOP_PATTERN = [2, 3, 3, 1, 1, 1, 2]; // 106: Stop (13 modules)

export type BarSegment = {
  width: number;
  isBlack: boolean;
};

/**
 * Encodes an ASCII string into an array of black/white bar widths adhering to Code 128B.
 */
export function encodeCode128B(text: string): BarSegment[] {
  const clean = text.trim() || "000000";
  const codes: number[] = [];

  // Start with Start Code B (104)
  const startCode = 104;
  codes.push(startCode);

  let checkSum = startCode;
  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i);
    // ASCII 32 (' ') to 126 ('~') map to 0..94
    const symbolVal = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    codes.push(symbolVal);
    checkSum += (i + 1) * symbolVal;
  }

  // Check digit
  codes.push(checkSum % 103);

  // Convert sequence of symbols into BarSegments
  const segments: BarSegment[] = [];

  // Add quiet zone (10 modules white)
  segments.push({ width: 10, isBlack: false });

  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0];
    for (let j = 0; j < pattern.length; j++) {
      segments.push({
        width: pattern[j],
        isBlack: j % 2 === 0, // Even index is Bar (Black), Odd index is Space (White)
      });
    }
  }

  // Add Stop pattern
  for (let j = 0; j < STOP_PATTERN.length; j++) {
    segments.push({
      width: STOP_PATTERN[j],
      isBlack: j % 2 === 0,
    });
  }

  // Add trailing quiet zone
  segments.push({ width: 10, isBlack: false });

  return segments;
}

/**
 * Builds an SVG string for HTML/PDF rendering of a scannable Code 128 barcode.
 */
export function generateBarcodeSvgHtml(text: string, height = 48): string {
  const segments = encodeCode128B(text);
  const totalWidth = segments.reduce((sum, s) => sum + s.width, 0);

  let currentX = 0;
  const rects: string[] = [];

  for (const s of segments) {
    if (s.isBlack) {
      rects.push(`<rect x="${currentX}" y="0" width="${s.width}" height="${height}" fill="#0f172a" />`);
    }
    currentX += s.width;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" style="width: 100%; max-width: 280px; height: ${height}px; display: block; margin: 0 auto;">
      ${rects.join("")}
    </svg>
  `;
}
