import { afterEach, describe, expect, it, vi } from "vitest";
import { createFontsourceLoader } from "./loader";

// Minimal valid-looking bytes; the loader only forwards bytes, it does not
// parse them (parsing happens later in loadFont, which these tests don't call).
const FAKE_FONT_BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

function mockFetch() {
  const urls: Array<string> = [];
  const spy = vi.fn((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response(FAKE_FONT_BYTES, { status: 200 }));
  });
  vi.stubGlobal("fetch", spy);
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFontsourceLoader generic-family mapping", () => {
  it("maps monospace to roboto-mono with one fetch and no monospace URL", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader();

    const file = await load({
      family: "monospace",
      weight: 400,
      italic: false,
    });

    expect(file.resolvedFamily).toBe("Roboto Mono");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/roboto-mono@");
    expect(urls.some((u) => u.includes("/monospace@"))).toBe(false);
  });
});
