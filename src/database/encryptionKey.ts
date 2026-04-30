import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const KEY_NAME = "omnipos_sqlcipher_aes256_material";

/**
 * Generates and persists device-bound cryptographic material intended for encrypted SQLite /
 * offline vault use. Plain Expo SQLite/WDB does not encrypt at rest unless you ship a
 * SQLCipher-enabled native adapter; callers should treat this as the future key source.
 */
export async function getOrCreateOfflineEncryptionMaterial(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) {
    return existing;
  }

  const randomBytes = Crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await SecureStore.setItemAsync(KEY_NAME, hex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });

  return hex;
}
