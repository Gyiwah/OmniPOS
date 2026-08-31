import * as FileSystem from "expo-file-system/legacy";

import { isLocalImageUri } from "@/src/core/images";
import { supabase } from "@/src/services/supabase";
import { usingLaravel } from "@/src/core/api/config";
import { laravelStorageService } from "./laravelStorage";

export { isLocalImageUri };

export const OMNIPOS_ASSETS_BUCKET = "omnipos-assets";

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;



function inferExtension(uri: string, mimeType?: string | null): string {
  if (mimeType) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("heic")) return "heic";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  }

  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (match) return match[1].toLowerCase();
  return "jpg";
}

function inferContentType(extension: string): string {
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function readLocalImageBytes(localUri: string, mimeType?: string | null): Promise<ArrayBuffer> {
  let readUri = localUri;

  if (localUri.startsWith("content://")) {
    const ext = inferExtension(localUri, mimeType);
    readUri = `${FileSystem.cacheDirectory ?? ""}product-upload-${Date.now()}.${ext}`;
    await FileSystem.copyAsync({ from: localUri, to: readUri });
  }

  const base64 = await FileSystem.readAsStringAsync(readUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToArrayBuffer(base64);
}

export function buildProductImagePath(storeId: string, productId: string, extension: string): string {
  return `${storeId}/products/${productId}.${extension}`;
}

export function buildStoreLogoPath(storeId: string, extension: string): string {
  return `${storeId}/branding/logo.${extension}`;
}

async function supabase_uploadProductImageFromUri(input: {
  storeId: string;
  productId: string;
  localUri: string;
  mimeType?: string | null;
}): Promise<string> {
  const extension = inferExtension(input.localUri, input.mimeType);
  const objectPath = buildProductImagePath(input.storeId, input.productId, extension);
  const bytes = await readLocalImageBytes(input.localUri, input.mimeType);

  const { error } = await supabase.storage.from(OMNIPOS_ASSETS_BUCKET).upload(objectPath, bytes, {
    contentType: inferContentType(extension),
    upsert: true,
  });
  if (error) throw new Error(error.message);

  return objectPath;
}

async function supabase_resolveProductImageUrl(imageRef: string | null | undefined): Promise<string | null> {
  if (!imageRef) return null;
  const trimmed = imageRef.trim();
  if (!trimmed) return null;
  if (isLocalImageUri(trimmed) || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  const { data, error } = await supabase.storage
    .from(OMNIPOS_ASSETS_BUCKET)
    .createSignedUrl(trimmed, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function supabase_uploadStoreLogoFromUri(input: {
  storeId: string;
  localUri: string;
  mimeType?: string | null;
}): Promise<string> {
  const extension = inferExtension(input.localUri, input.mimeType);
  const objectPath = buildStoreLogoPath(input.storeId, extension);
  const bytes = await readLocalImageBytes(input.localUri, input.mimeType);

  const { error } = await supabase.storage.from(OMNIPOS_ASSETS_BUCKET).upload(objectPath, bytes, {
    contentType: inferContentType(extension),
    upsert: true,
  });
  if (error) throw new Error(error.message);

  return objectPath;
}

async function supabase_resolveStoreLogoUrl(logoRef: string | null | undefined): Promise<string | null> {
  return resolveProductImageUrl(logoRef);
}

/*
 * Which backend stores images is decided once, here.
 *
 * Both keep the same {store_id}/... object paths, so a reference already held on
 * a product or a store resolves under either — nothing has to be rewritten at
 * cutover, and a half-migrated install still renders its catalogue.
 */

export const uploadProductImageFromUri = usingLaravel
  ? laravelStorageService.uploadProductImageFromUri
  : supabase_uploadProductImageFromUri;

export const uploadStoreLogoFromUri = usingLaravel
  ? laravelStorageService.uploadStoreLogoFromUri
  : supabase_uploadStoreLogoFromUri;

export const resolveProductImageUrl = usingLaravel
  ? laravelStorageService.resolveProductImageUrl
  : supabase_resolveProductImageUrl;

export const resolveStoreLogoUrl = usingLaravel
  ? laravelStorageService.resolveStoreLogoUrl
  : supabase_resolveStoreLogoUrl;

/**
 * Headers an <Image> needs to load a stored object.
 *
 * Laravel serves media behind authentication, so a bare URI renders as a broken
 * image with no indication why. Empty on Supabase, whose signed URLs carry their
 * own authorisation.
 */
export const imageAuthHeaders = usingLaravel
  ? laravelStorageService.imageAuthHeaders
  : async (): Promise<Record<string, string>> => ({});

export const storageService = {
  uploadProductImageFromUri,
  uploadStoreLogoFromUri,
  resolveProductImageUrl,
  resolveStoreLogoUrl,
  imageAuthHeaders,
};
