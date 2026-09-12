import { uuidv7 } from "@/src/core/ids";
import { storage } from "@/src/core/platform";

/**
 * This installation's identity, in one place.
 *
 * It lives here rather than in the sync engine because authentication needs it
 * too, and needs it *first*: the access token is named after this device, and
 * sign-in happens before the first sync. While the id was minted inside the
 * sync module, auth read the storage key directly and found nothing on a fresh
 * install, so every new till authenticated as "mobile:unregistered".
 *
 * That is not a cosmetic name. The server revokes any existing token with the
 * same name when one is issued, so that re-authenticating a till does not leave
 * tokens accumulating behind it. Two fresh tills therefore shared a name, and
 * signing in on the second silently signed the first out — a shop with two
 * phones could not keep both logged in.
 */
const DEVICE_KEY = "omnipos_laravel_device_id";

/**
 * Stable per-installation identity, minted on first use.
 *
 * Every caller goes through this, so the id exists from whichever of them runs
 * first and never differs between them.
 */
export async function getDeviceId(): Promise<string> {
  let id = await storage.getItem(DEVICE_KEY);

  if (!id) {
    id = uuidv7();
    await storage.setItem(DEVICE_KEY, id);
  }

  return id;
}
