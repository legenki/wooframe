# Importing large SingleFile snapshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a 10 MB SingleFile snapshot (webp/avif data-URI images, ~4500 elements) import faithfully: images transcode instead of going black, large captures don't time out, and conversion uses the real content height.

**Architecture:** Three independent fixes. Wall 1 (images) in `@woofigma/dom-to-figma`'s image loader: decode `data:` URIs to bytes directly (no fetch) and transcode webp/avif via `createImageBitmap` instead of `<img>`. Wall 2 (timeout) extracts a pure `computeLoadTimeout(htmlLength)` so it's node-testable, used by `render-host`. Wall 3 (height) sizes the render iframe to the measured content height before conversion so `fixed` elements position correctly. Snapshot tools, converter walkers, and the plugin UI are untouched.

**Tech Stack:** TypeScript, Vitest — browser project (Playwright chromium + canvas) for the image-loader changes; node project for the pure timeout formula. `createImageBitmap` for robust webp/avif decode.

---

## File Structure

- **Modify** `packages/dom-to-figma/src/converter/nodes/image/loader.ts` — add `decodeImageBytes`; rewrite `convertToPng` to use `createImageBitmap`; `createDirectImageLoader` calls `decodeImageBytes`.
- **Create** `packages/dom-to-figma/src/converter/nodes/image/loader.browser.test.ts` — browser tests for `decodeImageBytes` + `convertToPng`.
- **Create** `apps/plugin/src/ui/render-timeout.ts` — pure `computeLoadTimeout(htmlLength)`.
- **Create** `apps/plugin/src/ui/render-timeout.test.ts` — node test for the formula.
- **Modify** `apps/plugin/src/ui/render-host.ts` — use `computeLoadTimeout`; size the iframe to measured content height before conversion.

Order: images first (Task 1, the main visible fix), then the testable timeout (Task 2), then the height fix (Task 3).

---

## Task 1: Image loader — data-URI bytes + createImageBitmap transcode

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/image/loader.ts`
- Test: `packages/dom-to-figma/src/converter/nodes/image/loader.browser.test.ts`

- [ ] **Step 1: Write the failing browser test**

Create `packages/dom-to-figma/src/converter/nodes/image/loader.browser.test.ts`:

```ts
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
    // 2x2 lossless WebP (red). Decoded by createImageBitmap, re-encoded to PNG.
    const webp = await decodeImageBytes(
      "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA"
    );
    const info = await processImageFile(webp);
    expect(info.bytes.length).toBeGreaterThan(8);
    // PNG magic in the re-encoded output.
    expect(info.bytes.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser loader.browser.test.ts`
Expected: FAIL — `decodeImageBytes` is not exported.

- [ ] **Step 3: Add `decodeImageBytes` and use it in the loader**

In `packages/dom-to-figma/src/converter/nodes/image/loader.ts`, add the helper
and route the default loader through it. After the `ImageFile` type, add:

```ts
/**
 * Read image bytes for a src. A `data:<mime>;base64,<payload>` URI is decoded
 * directly (no network, no CORS); any other src is fetched. Returns the bytes
 * and the content type.
 */
export async function decodeImageBytes(src: string): Promise<ImageFile> {
  const dataMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (dataMatch) {
    const mimeType = dataMatch[1] || "application/octet-stream";
    const isBase64 = dataMatch[2] === ";base64";
    const payload = dataMatch[3] ?? "";
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes: bytes.buffer, mimeType };
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status}): ${src}`);
  }
  const blob = await response.blob();
  return { bytes: await blob.arrayBuffer(), mimeType: blob.type };
}
```

Replace `createDirectImageLoader` to use it:

```ts
export function createDirectImageLoader(): ImageLoader {
  return ({ src }) => decodeImageBytes(src);
}
```

- [ ] **Step 4: Rewrite `convertToPng` to use `createImageBitmap`**

Replace `convertToPng` and remove the now-unused `loadImageElement` /
`createCanvasFromImage` helpers, adding a bitmap-based canvas path:

```ts
async function convertToPng(file: ImageFile): Promise<ArrayBuffer> {
  const sourceBlob = new Blob([file.bytes], { type: file.mimeType });
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas for PNG conversion");
    }
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvasToBlob(canvas, "image/png", PNG_QUALITY);
    return await pngBlob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}
```

Delete the `loadImageElement` and `createCanvasFromImage` functions (no longer
referenced). Keep `canvasToBlob`, `sha1`, `isFigmaSupportedFormat`,
`processImageFile`, `FIGMA_SUPPORTED_FORMATS`, `PNG_QUALITY`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser loader.browser.test.ts`
Expected: PASS (3 tests) — data-URI decodes without fetch, http falls back, webp
transcodes to PNG.

- [ ] **Step 6: Typecheck + the package's browser suite (no regression)**

Run: `pnpm --filter @woofigma/dom-to-figma check-types && pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser`
Expected: PASS — existing `figma.image.browser.test.ts` still green.

- [ ] **Step 7: Format + commit**

```bash
pnpm exec biome check --write packages/dom-to-figma/src/converter/nodes/image/loader.ts packages/dom-to-figma/src/converter/nodes/image/loader.browser.test.ts
git add packages/dom-to-figma/src/converter/nodes/image/loader.ts packages/dom-to-figma/src/converter/nodes/image/loader.browser.test.ts
git commit -m "fix(dom-to-figma): decode data-URI images directly and transcode via createImageBitmap"
```

---

## Task 2: Adaptive load timeout (pure, node-tested)

**Files:**
- Create: `apps/plugin/src/ui/render-timeout.ts`
- Test: `apps/plugin/src/ui/render-timeout.test.ts`
- Modify: `apps/plugin/src/ui/render-host.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/plugin/src/ui/render-timeout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLoadTimeout } from "./render-timeout";

describe("computeLoadTimeout", () => {
  it("uses the 10 s base for small documents", () => {
    expect(computeLoadTimeout(0)).toBe(10_000);
    expect(computeLoadTimeout(500_000)).toBe(10_000);
  });

  it("adds 1 s per MB of HTML", () => {
    expect(computeLoadTimeout(10_000_000)).toBe(20_000);
  });

  it("caps at 60 s", () => {
    expect(computeLoadTimeout(100_000_000)).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter plugin exec vitest run render-timeout.test.ts`
Expected: FAIL — `./render-timeout` has no export `computeLoadTimeout`.

- [ ] **Step 3: Implement the pure formula**

Create `apps/plugin/src/ui/render-timeout.ts`:

```ts
// ~10 s base, +1 s per MB of HTML, capped at 60 s. Large SingleFile captures
// (10 MB+) overran the old fixed 10 s during doc.write + layout + image decode.
const BASE_MS = 10_000;
const PER_MB_MS = 1_000;
const MAX_MS = 60_000;
const MB = 1_000_000;

export function computeLoadTimeout(htmlLength: number): number {
  return Math.min(MAX_MS, BASE_MS + Math.ceil(htmlLength / MB) * PER_MB_MS);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter plugin exec vitest run render-timeout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in render-host**

In `apps/plugin/src/ui/render-host.ts`, import the formula and replace the fixed
timeout. Add at the top:

```ts
import { computeLoadTimeout } from "./render-timeout";
```

Remove the `const LOAD_TIMEOUT_MS = 10_000;` line. In `writeAndWait`, change the
`setTimeout` reject to use the computed value (derive it from the `html` length —
`writeAndWait` already receives `html`):

```ts
    const timer = setTimeout(
      () => reject(new Error("Render timed out")),
      computeLoadTimeout(html.length)
    );
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter plugin check-types && pnpm --filter plugin exec vitest run`
Expected: PASS.

```bash
pnpm exec biome check --write apps/plugin/src/ui/render-timeout.ts apps/plugin/src/ui/render-timeout.test.ts apps/plugin/src/ui/render-host.ts
git add apps/plugin/src/ui/render-timeout.ts apps/plugin/src/ui/render-timeout.test.ts apps/plugin/src/ui/render-host.ts
git commit -m "fix(plugin): adaptive render timeout based on HTML size"
```

---

## Task 3: Convert against the measured content height

**Files:**
- Modify: `apps/plugin/src/ui/render-host.ts`

- [ ] **Step 1: Size the iframe to the measured content height before conversion**

In `apps/plugin/src/ui/render-host.ts`, after `writeAndWait` and reading
`scrollWidth`/`scrollHeight`, set the iframe height to the measured content height
so `view.innerHeight` (used to position `fixed` elements in the converter)
matches the real page. Replace the block that reads dimensions and converts:

```ts
    const body = doc.body;
    const width = Math.max(1, Math.round(doc.documentElement.scrollWidth));
    const height = Math.max(1, Math.round(doc.documentElement.scrollHeight));

    // Match the iframe viewport to the real content height so position:fixed
    // elements (positioned against view.innerHeight in the converter) land
    // correctly on tall pages, instead of against the initial 4096px viewport.
    iframe.style.height = `${height}px`;

    const converter = createFigmaConverter();
    const result = await converter.convert({
      element: body,
      width,
      height,
      name: rootName,
    });
```

(The initial `RENDER_HEIGHT` stays as the first-pass layout height in the
`cssText`; this resize happens after layout, before conversion.)

- [ ] **Step 2: Typecheck + full plugin suite + build**

Run: `pnpm --filter plugin check-types && pnpm --filter plugin exec vitest run && pnpm --filter plugin build`
Expected: PASS; build emits dist artifacts. (No unit test asserts pixel
positions — the height fix is verified manually with a tall page that has a fixed
element.)

- [ ] **Step 3: Commit**

```bash
pnpm exec biome check --write apps/plugin/src/ui/render-host.ts
git add apps/plugin/src/ui/render-host.ts
git commit -m "fix(plugin): convert against the measured content height"
```

---

## Self-Review

- **Spec coverage:** Wall 1 — `decodeImageBytes` (data-URI no-fetch + fetch
  fallback) and `createImageBitmap` transcode (Task 1) ✓; Wall 2 — adaptive
  timeout as a pure tested function used by render-host (Task 2) ✓; Wall 3 —
  iframe sized to measured content height before conversion (Task 3) ✓; snapshot/
  extension/converter walkers untouched (no task touches them) ✓; tests: data-URI
  no-fetch, fetch fallback, webp→PNG magic, timeout formula (Tasks 1–2) ✓.
- **Placeholders:** none — full code, real base64 fixtures, exact commands.
- **Type/name consistency:** `decodeImageBytes(src): Promise<ImageFile>` defined
  in Task 1 and used by `createDirectImageLoader` and the test; `ImageFile`
  (`{ bytes: ArrayBuffer; mimeType: string }`) is the existing type, matched.
  `computeLoadTimeout(htmlLength: number): number` defined in Task 2 and called in
  render-host with `html.length`. `convertToPng`/`processImageFile` signatures
  unchanged.
- **Test infra:** image-loader tests run in the dom-to-figma **browser** project
  (Playwright + canvas + `createImageBitmap`), matching `figma.image.browser.
  test.ts`. The timeout formula is pure → the plugin **node** project tests it;
  render-host itself stays browser-only/untested (height fix manual).
- **Removed code:** `loadImageElement` and `createCanvasFromImage` are deleted in
  Task 1 Step 4 — confirm no other references (grep shows they're only used by the
  old `convertToPng`).