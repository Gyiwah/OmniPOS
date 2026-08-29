import { isLocalImageUri } from "@/src/services/storage";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductUpsertPayload = {
  id?: string;
  name?: string;
  sku?: string;
  barcode?: string | null;
  sell_price?: number;
  price?: number;
  cost_price?: number | null;
  stock?: number;
  reorder_level?: number | null;
  expiry_date?: string | null;
  image_url?: string | null;
  local_image_uri?: string | null;
  local_image_mime?: string | null;
  tags?: string[];
  is_active?: boolean;
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Accept remote http(s) URLs or Supabase storage object paths. */
export function storedImageRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || isLocalImageUri(trimmed)) return null;
  return trimmed;
}

/** Postgres image_url must not be a local device URI. */
export function remoteImageUrlOnly(url: string | null | undefined): string | null {
  const ref = storedImageRef(url);
  if (!ref) return null;
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return ref;
  }
  return ref;
}

/** Map local sync payload to public.products columns. */
export function buildProductRowForSupabase(
  storeId: string,
  body: ProductUpsertPayload,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    store_id: storeId,
    name: body.name ?? "",
    sku: body.sku ?? "",
    barcode: body.barcode ?? null,
    price: Number(body.price ?? body.sell_price ?? 0),
    cost_price: body.cost_price == null ? null : Number(body.cost_price),
    stock: Number(body.stock ?? 0),
    reorder_level: body.reorder_level != null ? Number(body.reorder_level) : 5,
    expiry_date: body.expiry_date ? String(body.expiry_date).slice(0, 10) : null,
    image_url: storedImageRef(body.image_url),
    tags: Array.isArray(body.tags) ? body.tags : [],
    is_active: body.is_active ?? true,
  };

  if (body.id && isUuid(body.id)) {
    row.id = body.id;
  }

  return row;
}

export function resolveProductIdForImage(body: ProductUpsertPayload, recordId?: string): string | undefined {
  if (body.id && isUuid(body.id)) return body.id;
  if (recordId && isUuid(recordId)) return recordId;
  return undefined;
}
