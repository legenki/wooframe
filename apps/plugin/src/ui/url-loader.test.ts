import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHtmlFromUrl } from "./url-loader";

function stubFetch(
  impl: (url: string) => Response | Promise<Response>
): Array<string> {
  const urls: Array<string> = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    return Promise.resolve(impl(url));
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadHtmlFromUrl", () => {
  it("returns the body for a direct 200 text/html response", async () => {
    stubFetch(
      () =>
        new Response("<!doctype html><html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<body>hi</body>");
  });

  it("substitutes {url} (encoded) into the proxy template", async () => {
    const urls = stubFetch(
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    await loadHtmlFromUrl("https://a.com/x?y=1", "https://p/?url={url}");
    expect(urls[0]).toBe(
      `https://p/?url=${encodeURIComponent("https://a.com/x?y=1")}`
    );
  });

  it("throws on a non-2xx response", async () => {
    stubFetch(() => new Response("nope", { status: 502 }));
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /HTTP 502/
    );
  });

  it("throws when the body is not HTML", async () => {
    stubFetch(
      () =>
        new Response('{"a":1}', {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /did not return HTML/
    );
  });

  it("accepts an HTML body even without a text/html content-type", async () => {
    stubFetch(
      () => new Response("<!DOCTYPE html><html></html>", { status: 200 })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<html>");
  });

  it("propagates a fetch rejection (CORS/network)", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Failed to fetch")));
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /Failed to fetch/
    );
  });

  it("throws (without fetching) when the proxy template lacks {url}", async () => {
    const urls = stubFetch(
      () => new Response("<html></html>", { status: 200 })
    );
    await expect(
      loadHtmlFromUrl("https://example.com", "https://p/no-placeholder")
    ).rejects.toThrow(/\{url\} placeholder/);
    expect(urls).toHaveLength(0);
  });

  it("accepts a parameterized text/html content-type", async () => {
    stubFetch(
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<html>");
  });
});
