/**
 * Turn a stored product image reference into a same-origin media URL.
 *
 * The catalogue holds an object path (`{store_id}/products/{id}.png`), a legacy
 * `/api/media/...` URL, or (rarely) an already-absolute address. Browser <img>
 * tags cannot attach the Sanctum session the way fetch() can, so callers should
 * load this URL through AuthenticatedMedia rather than as a raw src.
 */
export function mediaObjectUrl(imageRef: string): string {
  const trimmed = imageRef.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("/api/media/") || trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith("/api/media/")) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Malformed absolute value: treat it as an object path below.
    }
    // A leftover signed URL from the Supabase bucket still loads as itself.
    return trimmed;
  }

  return `/api/media/${trimmed.replace(/^\/+/, "")}`;
}
