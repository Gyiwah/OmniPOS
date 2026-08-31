import "fake-indexeddb/auto";

// The uuidv7 generator deliberately refuses to fall back to Math.random, so the
// test environment must expose a real secure random source. Node 20+ provides
// globalThis.crypto natively; fail loudly rather than silently weakening ids.
if (!globalThis.crypto?.getRandomValues) {
  throw new Error("Test environment has no Web Crypto. Node 20+ is required.");
}
