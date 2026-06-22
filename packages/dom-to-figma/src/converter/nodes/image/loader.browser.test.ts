import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImageBytes, processImageFile } from "./loader";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A 1x1 red PNG.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("decodeImageBytes", () => {
  it("decodes a data: URI without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const file = await decodeImageBytes(PNG_1X1);
    expect(file.mimeType).toBe("image/png");
    expect(new Uint8Array(file.bytes).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to fetch for an http(s) src", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(bytes, { headers: { "content-type": "image/png" } })
        )
      )
    );
    const file = await decodeImageBytes("https://example.com/a.png");
    expect(file.mimeType).toBe("image/png");
    expect(new Uint8Array(file.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("convertToPng via processImageFile", () => {
  it("transcodes a WebP image to PNG bytes", async () => {
    // 2x2 lossless WebP. Decoded by createImageBitmap, re-encoded to PNG.
    const webp = await decodeImageBytes(
      "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA"
    );
    const info = await processImageFile(webp);
    expect(info.bytes.length).toBeGreaterThan(8);
    // PNG magic in the re-encoded output.
    expect(info.bytes.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
