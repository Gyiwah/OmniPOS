/**
 * UUIDv7 (RFC 9562 §5.7) — time-ordered, client-minted identifiers.
 *
 * Deliberately identical in behaviour to the mobile app's src/core/ids/uuidv7.ts.
 * Both clients mint their own record ids offline and the server accepts them
 * verbatim, so a record's local key IS its server key. That is what makes the
 * sync push a plain idempotent upsert instead of a reconciliation problem.
 *
 * Version 7 rather than 4 because every one of these becomes a Postgres primary
 * key: the leading millisecond timestamp keeps inserts near-sequential in the
 * B-tree instead of scattering them across it.
 *
 * Layout:
 *   48 bits  unix_ts_ms   big-endian
 *    4 bits  version      0b0111
 *   12 bits  counter      monotonic within a millisecond
 *    2 bits  variant      0b10
 *   62 bits  random
 */

const VARIANT_MASK = 0x3f;
const VARIANT_BITS = 0x80;
const VERSION_BITS = 0x70;
const MAX_COUNTER = 0xfff;

/**
 * A new millisecond seeds the counter with 11 random bits rather than 12,
 * leaving at least 2048 monotonic increments of headroom before it can overflow.
 */
const COUNTER_SEED_MASK = 0x7ff;

let lastTimestamp = -1;
let counter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) {
    // Deliberately fatal. Falling back to Math.random would weaken id
    // uniqueness across tills, and a duplicate order id means a lost sale.
    throw new Error("[OmniPOS] Secure random unavailable. A secure context (HTTPS or localhost) is required.");
  }
  webCrypto.getRandomValues(bytes);
  return bytes;
}

function seedCounter(): number {
  const seed = randomBytes(2);
  return ((seed[0] << 8) | seed[1]) & COUNTER_SEED_MASK;
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function format(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i]];
  }
  return out;
}

/** Generate a monotonic UUIDv7. */
export function uuidv7(): string {
  const now = Date.now();
  let ts: number;

  if (now > lastTimestamp) {
    ts = now;
    lastTimestamp = now;
    counter = seedCounter();
  } else {
    // Same millisecond, or the wall clock moved backwards (NTP correction, a
    // manual change, timezone tampering on a till). Either way hold the last
    // timestamp and advance the counter so ids never regress.
    counter += 1;
    if (counter > MAX_COUNTER) {
      lastTimestamp += 1;
      counter = seedCounter();
    }
    ts = lastTimestamp;
  }

  const bytes = randomBytes(16);

  // 48-bit timestamp. Bytes 0-1 come from above 2^32, so they are derived by
  // division rather than bit shifts (JS bitwise operands are 32-bit).
  const tsHigh = Math.floor(ts / 0x100000000);
  const tsLow = ts % 0x100000000;
  bytes[0] = (tsHigh >>> 8) & 0xff;
  bytes[1] = tsHigh & 0xff;
  bytes[2] = (tsLow >>> 24) & 0xff;
  bytes[3] = (tsLow >>> 16) & 0xff;
  bytes[4] = (tsLow >>> 8) & 0xff;
  bytes[5] = tsLow & 0xff;

  bytes[6] = VERSION_BITS | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = VARIANT_BITS | (bytes[8] & VARIANT_MASK);

  return format(bytes);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Test seam: reset monotonic state so generation is deterministic per test. */
export function __resetUuidv7State(): void {
  lastTimestamp = -1;
  counter = 0;
}
