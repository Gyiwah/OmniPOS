import { useEffect, useState, type ReactNode } from "react";

import { mediaObjectUrl } from "./mediaUrl";

type Props = {
  imageRef: string;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
};

/**
 * Load a Sanctum-protected media object.
 *
 * GET /api/media/{path} is authenticated. A bare <img src> cannot send the
 * session the way fetch() can (no Origin, no X-Requested-With), so it 401s and
 * the browser draws a broken-image icon. Fetching with credentials and handing
 * the bytes to a blob URL is the same trick the mobile client uses with a
 * bearer header.
 */
export function AuthenticatedMedia({ imageRef, alt = "", className, fallback = null }: Props) {
  const src = mediaObjectUrl(imageRef);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setObjectUrl(null);
      return;
    }

    if (src.startsWith("blob:") || src.startsWith("data:") || /^https?:\/\//i.test(src)) {
      setObjectUrl(src);
      return;
    }

    let cancelled = false;
    setObjectUrl(null);

    void (async () => {
      try {
        const response = await fetch(src, {
          credentials: "include",
          headers: {
            Accept: "image/*,application/octet-stream;q=0.9,*/*;q=0.8",
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectUrl(url);
      } catch {
        // Offline or a missing object: the fallback placeholder is the honest UI.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!objectUrl || objectUrl.startsWith("http") || objectUrl.startsWith("data:")) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  if (!objectUrl) return fallback;

  return <img src={objectUrl} alt={alt} className={className} />;
}
