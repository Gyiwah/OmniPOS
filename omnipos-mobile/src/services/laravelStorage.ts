import * as FileSystem from "expo-file-system/legacy";

import { api } from "@/src/core/api/client";
import { API_BASE_URL } from "@/src/core/api/config";
import { getToken } from "@/src/core/api/client";
import { isLocalImageUri } from "@/src/core/images";

/**
 * Product images and store logos, over the Laravel API.
 *
 * Object paths keep the {store_id}/... layout the Supabase bucket used, so
 * references already stored on products and stores keep resolving after the
 * migration — nothing has to be rewritten.
 *
 * Reads go through an authenticated endpoint rather than a signed URL. The
 * bucket was protected by RLS; the server now checks store membership on every
 * read instead, which means an image URL is useless without a token.
 */

function inferExtension(uri: string, mimeType?: string | null): string {
  if (mimeType) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("heic")) return "heic";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  }

  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? match[1].toLowerCase() : "jpg";
}

function contentTypeFor(extension: string): string {
  switch (extension) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

/**
 * Uploaded as multipart via FileSystem.uploadAsync rather than read into memory
 * first. A product photo from a phone camera can be several megabytes, and
 * base64-encoding it in JS is both slow and a real out-of-memory risk on the
 * low-end hardware a shop is likely to be using.
 */
async function upload(
  localUri: string,
  fields: Record<string, string>,
  mimeType?: string | null,
): Promise<string> {
  const extension = inferExtension(localUri, mimeType);
  const token = await getToken();

  const result = await FileSystem.uploadAsync(`${API_BASE_URL}/api/media`, localUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: contentTypeFor(extension),
    parameters: fields,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fields.store_id ? { "X-Store-Id": fields.store_id } : {}),
    },
  });

  if (result.status < 200 || result.status >= 300) {
    let message = `Upload failed with status ${result.status}`;
    try {
      const body = JSON.parse(result.body) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new Error(message);
  }

  const body = JSON.parse(result.body) as { path: string };
  return body.path;
}

export async function uploadProductImageFromUri(input: {
  storeId: string;
  productId: string;
  localUri: string;
  mimeType?: string | null;
}): Promise<string> {
  return upload(
    input.localUri,
    { kind: "product", product_id: input.productId, store_id: input.storeId },
    input.mimeType,
  );
}

export async function uploadStoreLogoFromUri(input: {
  storeId: string;
  localUri: string;
  mimeType?: string | null;
}): Promise<string> {
  return upload(input.localUri, { kind: "logo", store_id: input.storeId }, input.mimeType);
}

/**
 * Turn a stored object path into something an <Image> can load.
 *
 * Already-resolvable references pass through untouched: a local device URI
 * belongs to a picture not yet uploaded, and an absolute URL is either already
 * signed or came from somewhere else entirely.
 */
export async function resolveProductImageUrl(imageRef: string | null | undefined): Promise<string | null> {
  if (!imageRef) return null;

  const trimmed = imageRef.trim();
  if (!trimmed) return null;

  if (isLocalImageUri(trimmed) || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `${API_BASE_URL}/api/media/${trimmed}`;
}

export async function resolveStoreLogoUrl(logoRef: string | null | undefined): Promise<string | null> {
  return resolveProductImageUrl(logoRef);
}

/**
 * Headers an image request needs.
 *
 * Media is behind authentication, so <Image source={{ uri, headers }} /> must
 * carry the bearer token. A plain URI renders as a broken image with no clue
 * why, which is a genuinely confusing failure to debug.
 */
export async function imageAuthHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function deleteObject(path: string): Promise<void> {
  await api.delete(`/api/media/${path}`);
}

export const laravelStorageService = {
  uploadProductImageFromUri,
  uploadStoreLogoFromUri,
  resolveProductImageUrl,
  resolveStoreLogoUrl,
  imageAuthHeaders,
  deleteObject,
};
