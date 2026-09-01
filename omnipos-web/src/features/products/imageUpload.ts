import { primeCsrf } from "@/api/client";
import { db } from "@/db/schema";

/**
 * Product images, uploaded from a browser.
 *
 * Not routed through the shared api client because that one serialises every
 * body as JSON. A multipart upload has to hand the browser a FormData and let it
 * set its own Content-Type, boundary included — setting it by hand produces a
 * body the server cannot parse.
 *
 * Everything else the client does still applies: the CSRF cookie is primed
 * first, credentials travel, and the store header identifies the tenant.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];

export async function uploadProductImage(input: {
  storeId: string;
  productId: string;
  file: File;
}): Promise<string> {
  if (!ACCEPTED.includes(input.file.type)) {
    throw new Error("That file is not an image the server accepts. Use JPEG, PNG, WebP or GIF.");
  }

  if (input.file.size > MAX_BYTES) {
    // Checked here as well as on the server so a cashier on a slow connection is
    // not made to upload five megabytes before being told no.
    throw new Error(`That image is ${(input.file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`);
  }

  await primeCsrf();

  const body = new FormData();
  body.append("file", input.file);
  body.append("kind", "product");
  body.append("product_id", input.productId);

  const response = await fetch("/api/media", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Store-Id": input.storeId,
      ...csrfHeader(),
    },
    body,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Upload failed with status ${response.status}`;
    throw new Error(message);
  }

  const url = String((payload as { url?: unknown })?.url ?? "");

  // Written straight to the local catalogue: the image is not part of the
  // product's sync payload, so nothing else would bring it back to this device.
  await db.products.update(input.productId, { image_url: url });

  return url;
}

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(^|; )XSRF-TOKEN=([^;]*)/);
  return match ? { "X-XSRF-TOKEN": decodeURIComponent(match[2]) } : {};
}
