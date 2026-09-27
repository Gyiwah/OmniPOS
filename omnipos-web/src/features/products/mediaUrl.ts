
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
