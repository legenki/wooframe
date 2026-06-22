# Restore `<img>` fallback so SVG images decode — design

**Date:** 2026-06-22
**Package:** `@woofigma/dom-to-figma` (image loader only)
**Status:** Approved, pending implementation

## Problem (root cause verified in chromium)

After the SHA-1 fix, the dominant import error is now
`InvalidStateError: The source image could not be decoded` (~100+ on the
posterlad SingleFile). The page has 97 webp + 8 avif + **15 svg** data-URI images.

Commit `46f5bfe` replaced the original `<img>`+canvas decoder in `convertToPng`
with `createImageBitmap(blob)`. Verified directly in the package's browser
(Playwright chromium):

- WebP via `createImageBitmap` → **OK** (decodes).
- AVIF via `createImageBitmap` → **OK** (decodes).
- **SVG via `createImageBitmap` → `InvalidStateError`** (fails).
- The same **SVG via `<img src=objectURL>` → OK** (rasterizes fine).

So `createImageBitmap` cannot decode SVG (it's a vector format), but the `<img>`
path — which `46f5bfe` deleted — rasterizes SVG (and everything else the browser
can render). The fix narrowed format coverage and lost SVG.

(`createImageBitmap` was adopted to avoid the `<img>.onload` race for raster
images; that benefit is kept by trying it first.)

## Fix

In `convertToPng` (`image/loader.ts`), try `createImageBitmap` first and fall
back to `<img>`+canvas on failure:

1. Try `createImageBitmap(blob)` → draw onto a canvas → PNG. (Current path; robust
   for webp/avif/png/jpeg/gif raster.)
2. On any failure, fall back to the **`<img src=objectURL>` + canvas** path:
   load the blob as an object URL into an `Image`, draw it onto a canvas sized to
   `naturalWidth`/`naturalHeight`, encode PNG. This handles SVG (and any other
   format `<img>` can render).
3. If both paths fail, throw — the image is skipped per-paint with a warning in
   the plugin builder (unchanged isolation).

Re-add the helpers `46f5bfe` removed: `loadImageElement(objectUrl)` (Image +
onload/onerror promise) and a canvas-from-`<img>` step. Revoke the object URL in
a `finally`.

## Shared canvas→PNG helper

Both paths draw onto a canvas and encode PNG; extract a small
`canvasToPngBytes(canvas)` (wraps the existing `canvasToBlob` + `arrayBuffer`) so
the bitmap and `<img>` branches share the encode step and the function stays
readable.

## Unit boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `convertToPng(file)` | bitmap-then-`<img>` decode → PNG bytes | the two helpers below |
| `decodeViaBitmap(blob)` | `createImageBitmap` → canvas → PNG; throws on undecodable | `createImageBitmap` |
| `decodeViaImg(blob)` | object-URL `<img>` → canvas → PNG; throws on `onerror` | `Image`, canvas |

`canvasToBlob`, `sha1Bytes`, `processImageFile`, `decodeImageBytes`,
`createDirectImageLoader`, `FIGMA_SUPPORTED_FORMATS` unchanged. Converter
walkers, plugin builder, and snapshot tools untouched.

## Testing

`loader.browser.test.ts` (browser project, where the image tests live):

1. **SVG transcodes** (the regression): `processImageFile` on a
   `data:image/svg+xml;base64,…` (a 4×4 rect) returns PNG bytes starting with the
   PNG magic `89 50 4e 47`. Fails today (bitmap-only), passes after the fallback.
2. **WebP still transcodes** via the bitmap path (existing test, unchanged).
3. **Undecodable isolation**: garbage bytes with `image/avif` mime fail **both**
   paths → `processImageFile` rejects (the plugin skips that one image), not
   hangs. (Existing test, still valid — neither path decodes garbage.)

## Out of scope (separate reported issues, each its own root cause)

- **White section covering text** — a z-order / paint-order problem in the
  converter, not image-related. Separate investigation.
- **emoji glyphs (`✈` U+2708, U+FE0F)** — not in the font; same class as the
  earlier icon-glyph fallback. Could extend the symbol fallback chain later.
- AVIF that a given browser can't decode (chromium decodes it; some contexts may
  not) — those few would still skip with a warning.
