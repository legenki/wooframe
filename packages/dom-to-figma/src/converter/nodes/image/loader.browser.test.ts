import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImageBytes, processImageFile, sha1Bytes } from "./loader";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

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

describe("sha1Bytes", () => {
  it("matches the standard SHA-1 of 'abc'", () => {
    expect(sha1Bytes(utf8("abc"))).toEqual([
      0xa9, 0x99, 0x3e, 0x36, 0x47, 0x06, 0x81, 0x6a, 0xba, 0x3e, 0x25, 0x71,
      0x78, 0x50, 0xc2, 0x6c, 0x9c, 0xd0, 0xd8, 0x9d,
    ]);
  });

  it("hashes the empty input", () => {
    expect(sha1Bytes(utf8(""))).toEqual([
      0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef,
      0x95, 0x60, 0x18, 0x90, 0xaf, 0xd8, 0x07, 0x09,
    ]);
  });
});

describe("processImageFile without crypto.subtle", () => {
  it("hashes a PNG even when crypto.subtle is undefined", async () => {
    // Reproduce the Figma iframe: no SubtleCrypto.
    vi.stubGlobal("crypto", {});
    const png = await decodeImageBytes(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    );
    const info = await processImageFile(png);
    expect(info.hash).toHaveLength(20);
    expect(info.bytes.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("undecodable image isolation", () => {
  it("rejects (does not hang) on garbage image bytes", async () => {
    const garbage = {
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: "image/avif",
    };
    await expect(processImageFile(garbage)).rejects.toBeDefined();
  });
});

describe("convertToPng SVG fallback", () => {
  it("transcodes an SVG (createImageBitmap can't, <img> can)", async () => {
    const svg = `data:image/svg+xml;base64,${btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>'
    )}`;
    const file = await decodeImageBytes(svg);
    const info = await processImageFile(file);
    expect(info.bytes.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(info.bytes.length).toBeGreaterThan(8);
  });
});
