import { primeCsrf } from "@/api/client";
import { db } from "@/db/schema";
import { enqueue } from "@/sync/engine";


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

  // Store the object key, not the backend origin. The SPA may be served through
  // a Vite or reverse-proxy origin, while media access relies on that origin's
  // Sanctum session cookie.
  const path = String((payload as { path?: unknown })?.path ?? "");
  if (!path) throw new Error("Image upload did not return an object path.");

  // Keep the local catalogue and the outbox in lockstep. MediaController also
  // writes products.image_url, but a later product upsert that omitted the path
  // used to leave the column null on the server while this till still showed a
  // thumbnail.
  await db.transaction("rw", [db.products, db.outbox], async () => {
    await db.products.update(input.productId, { image_url: path });
    const product = await db.products.get(input.productId);
    if (!product) return;
    await enqueue({
      storeId: input.storeId,
      entity: "products",
      action: "upsert",
      recordId: product.id,
      payload: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        price: product.price,
        cost_price: product.cost_price,
        reorder_level: product.reorder_level,
        category_id: product.category_id,
        is_active: product.is_active,
        tags: product.tags,
        image_url: path,
      },
    });
  });

  return path;
}

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(^|; )XSRF-TOKEN=([^;]*)/);
  return match ? { "X-XSRF-TOKEN": decodeURIComponent(match[2]) } : {};
}
