import { platformCrypto } from "@/src/core/platform";

/**
 * UUIDv7 (RFC 9562 §5.7) — time-ordered, client-minted identifiers.
 *
 * OmniPOS mints record IDs on the device, offline, and the server accepts them
 * verbatim; the client's ID *is* the server's ID. Version 7 rather than 4 because
 * every generated ID becomes a Postgres primary key: v4 scatters inserts across
 * the B-tree, while v7's leading millisecond timestamp keeps them near-sequential
 * on the hot tables (orders, order_items, stock_movements).
 *
 * Layout:
 *   48 bits  unix_ts_ms      big-endian
 *    4 bits  version         0b0111
 *   12 bits  counter         monotonic within a millisecond
 *    2 bits  variant         0b10
 *   62 bits  random
 */

const VARIANT_MASK = 0x3f;
const VARIANT_BITS = 0x80;
const VERSION_BITS = 0x70;
const MAX_COUNTER = 0xfff;

/**
 * New milliseconds seed the counter with 11 random bits rather than 12, leaving at
 * least 2048 monotonic increments of headroom before the counter can overflow.
 */
const COUNTER_SEED_MASK = 0x7ff;

let lastTimestamp = -1;
let counter = 0;

function seedCounter(): number {
  const seed = new Uint8Array(2);
  platformCrypto.getRandomValues(seed);
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
    // Same millisecond, or the wall clock moved backwards (NTP correction,
    // manual change, timezone-tampering on a POS terminal). Either way we hold
    // the last timestamp and advance the counter so IDs never regress.
    counter += 1;
    if (counter > MAX_COUNTER) {
      lastTimestamp += 1;
      counter = seedCounter();
    }
    ts = lastTimestamp;
  }

  const bytes = new Uint8Array(16);
  platformCrypto.getRandomValues(bytes);

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

/** True for any RFC 9562 UUID of version 1-8 with the correct variant. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Extract the embedded creation time from a UUIDv7, or null if not a v7. */
export function uuidv7Timestamp(value: string): number | null {
  if (!isUuid(value) || value[14] !== "7") return null;
  const hex = value.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}

/** Test seam: reset monotonic state so generation is deterministic per test. */
export function __resetUuidv7State(): void {
  lastTimestamp = -1;
  counter = 0;
}
