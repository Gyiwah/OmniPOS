import { getSecureStorage, platformCrypto } from "@/src/core/platform";

const KEY_NAME = "omnipos_sqlcipher_aes256_material";

/**
 * Generates and persists device-bound cryptographic material intended for encrypted SQLite /
 * offline vault use. Plain Expo SQLite/WDB does not encrypt at rest unless you ship a
 * SQLCipher-enabled native adapter; callers should treat this as the future key source.
 *
 * Returns null on hosts with no OS-managed secret store (browsers). Writing key
 * material to localStorage would make it readable by any script on the origin, so
 * the web client must not hold this key — it is a device-only facility.
 */
export async function getOrCreateOfflineEncryptionMaterial(): Promise<string | null> {
  const secureStorage = getSecureStorage();
  if (!secureStorage) return null;

  const existing = await secureStorage.getItem(KEY_NAME);
  if (existing) {
    return existing;
  }

  const randomBytes = platformCrypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await secureStorage.setItem(KEY_NAME, hex);

  return hex;
}
