import { describe, expect, it } from "vitest";

import { mediaObjectUrl } from "./mediaUrl";

describe("mediaObjectUrl", () => {
  it("leaves an already-relative media path alone", () => {
    expect(mediaObjectUrl("/api/media/store/products/p.png")).toBe("/api/media/store/products/p.png");
  });

  it("prefixes an object path", () => {
    expect(mediaObjectUrl("store/products/p.png")).toBe("/api/media/store/products/p.png");
  });

  it("strips a same-API absolute URL down to the path so the cookie stays first-party", () => {
    expect(mediaObjectUrl("http://127.0.0.1:8000/api/media/store/products/p.png")).toBe(
      "/api/media/store/products/p.png",
    );
  });

  it("does not wrap a leftover signed URL as a media path", () => {
    const signed = "https://example.supabase.co/storage/v1/object/sign/omnipos-assets/store/p.png";
    expect(mediaObjectUrl(signed)).toBe(signed);
  });
});
