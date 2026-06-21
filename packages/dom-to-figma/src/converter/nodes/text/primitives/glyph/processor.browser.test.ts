import { beforeAll, describe, expect, it } from "vitest";
import interUrl from "../../../../../__fixtures__/fonts/inter-latin-400.ttf?url";
import mathUrl from "../../../../../__fixtures__/fonts/noto-sans-math-latin-400.woff2?url";
import type { LoadedFont } from "../font";
import { loadFont } from "../font/loader";
import {
  collectCodepointsMissingFromFont,
  processGlyphs,
  resolveGlyphFont,
} from "./processor";

const props = { family: "X", weight: 400, italic: false };

async function load(url: string): Promise<LoadedFont> {
  const bytes = await (await fetch(url)).arrayBuffer();
  return loadFont(() => Promise.resolve({ bytes }), props);
}

let inter: LoadedFont;
let math: LoadedFont;

beforeAll(async () => {
  inter = await load(interUrl);
  math = await load(mathUrl);
});

describe("collectCodepointsMissingFromFont", () => {
  it("returns codepoints absent from the font, ignoring covered ones", () => {
    // ▾ U+25BE is absent from Inter; 'A' is present.
    const missing = collectCodepointsMissingFromFont(inter, "A▾");
    expect(missing.has(0x25_be)).toBe(true);
    expect(missing.has(0x41)).toBe(false);
  });
});

describe("resolveGlyphFont", () => {
  it("returns the primary when it has the glyph", () => {
    expect(resolveGlyphFont(inter, [math], 0x41)).toBe(inter);
  });

  it("returns the first fallback that has the glyph", () => {
    // ▾ U+25BE: absent in Inter, present in Math.
    expect(resolveGlyphFont(inter, [math], 0x25_be)).toBe(math);
  });

  it("prefers the primary even when a fallback also has the glyph", () => {
    // 'A' exists in both; primary wins.
    expect(resolveGlyphFont(inter, [math], 0x41)).toBe(inter);
  });

  it("returns null when no font has the glyph", () => {
    // U+E000 (private use) is in neither fixture.
    expect(resolveGlyphFont(inter, [math], 0xe0_00)).toBeNull();
  });
});

describe("processGlyphs with fallback fonts", () => {
  const blobs: Array<{ bytes: Array<number> }> = [];
  const register = (b: { bytes: Array<number> }) => {
    blobs.push(b);
    return blobs.length - 1;
  };

  it("produces a glyph for a char missing from primary but in a fallback", () => {
    // ▾ U+25BE: absent in Inter, present in Math.
    const out = processGlyphs(
      inter,
      "▾",
      { fontSize: 16, includeWhitespace: false },
      register,
      [math]
    );
    const data = out.glyphDataMap.get("▾");
    expect(data).toBeDefined();
    expect(data?.bytes.length).toBeGreaterThan(1);
    // Advance comes from Math (the font that supplied the glyph), non-zero.
    expect(data?.advance).toBeGreaterThan(0);
  });

  it("drops a char present in no font and produces no entry", () => {
    // U+E000 (private use) is in neither Inter nor Math.
    const pua = String.fromCodePoint(0xe0_00);
    const out = processGlyphs(
      inter,
      pua,
      { fontSize: 16, includeWhitespace: false },
      register,
      [math]
    );
    expect(out.glyphDataMap.has(pua)).toBe(false);
  });

  it("still maps a normal char from the primary with no fallbacks", () => {
    const out = processGlyphs(
      inter,
      "A",
      { fontSize: 16, includeWhitespace: false },
      register,
      []
    );
    expect(out.glyphDataMap.get("A")?.bytes.length).toBeGreaterThan(1);
  });
});
