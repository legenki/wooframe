# Importing large SingleFile snapshots — design

**Date:** 2026-06-22
**Package:** `apps/plugin` (render-host) + `@woofigma/dom-to-figma` (image loader); snapshot/extension/converter-core unchanged
**Status:** Approved, pending implementation

## Problem (diagnosed on a real 10 MB SingleFile artifact)

A SingleFile capture of `posterlad.com/pages/collabs` (10 MB, ~4480 elements, 241
`<img>`, images embedded as `data:image/webp` ×97 / `data:image/avif` ×8 /
`data:image/svg+xml` ×15) imports into the plugin **incompletely**: images render
**black** and large captures fail to import. The SingleFile snapshot itself is
good (absolute/data URLs, CORS already solved by SingleFile in the user's
session). The failures are in the plugin's import path, across three independent
walls:

1. **WebP/AVIF images come out black.** `figma.createImage` accepts only
   PNG/JPEG/GIF (verified in the Figma API docs — others throw `"Image type is
   unsupported"`), so the converter must transcode. Its `convertToPng` decodes
   via `<img>.onload` + canvas, which is unreliable for in-memory webp/avif at
   scale → blank/black canvas. Also, the default image loader does `fetch(src)`,
   which is wasteful for `data:` URIs (and would CORS-fail for remote ones).
2. **Load timeout.** `render-host.ts` uses a fixed `LOAD_TIMEOUT_MS = 10_000`. A
   10 MB `doc.write` + laying out 4480 nodes + decoding 241 images overruns 10 s.
3. **Fixed render viewport height.** The render iframe is `height: 4096px`. Page
   height is read from `scrollHeight` (which is correct — not clipped), but
   `position: fixed` elements are positioned against the iframe's viewport
   (`view.innerHeight = 4096`, see `frame/converter.ts:43`), so on a much taller
   page they land at the wrong y.

## Goal

Remove the three walls so large SingleFile snapshots import faithfully. **No
guarantee for arbitrarily huge pages** — the QuickJS plugin sandbox has memory
limits; this makes a 10 MB / ~4500-element / ~250-image capture work, not "any
size." The snapshot tools (bookmarklet/extension) are unchanged; SingleFile
stays an external option for image-heavy/cross-origin pages.

## Wall 1 — images (the main fix)

In `packages/dom-to-figma/src/converter/nodes/image/loader.ts`:

- **`decodeImageBytes(src)`** — a new helper. For a `data:<mime>;base64,<payload>`
  URI, decode the base64 to bytes directly (no `fetch`) and return
  `{ bytes, mimeType }` parsed from the URI. For any other `src`, fall back to the
  existing `fetch(src)` path. This removes the network round-trip and CORS risk
  for SingleFile's inlined images.
- **`convertToPng`** — replace the `<img>.onload` decode with
  `createImageBitmap(blob)` then draw the bitmap onto a canvas and
  `canvas.toBlob("image/png")`. `createImageBitmap` is the robust in-memory
  decoder for webp/avif and avoids `<img>` load races / taint. Keep the
  PNG-passthrough for already-supported formats.
- `processImageFile` / `isFigmaSupportedFormat` / `FIGMA_SUPPORTED_FORMATS`
  unchanged (PNG/JPEG/GIF pass through; webp/avif/svg transcode).

The default `createDirectImageLoader` is updated to call `decodeImageBytes`
instead of a bare `fetch`.

## Wall 2 — timeout

In `apps/plugin/src/ui/render-host.ts`, replace the fixed `LOAD_TIMEOUT_MS` with
an adaptive ceiling so large documents get more time without making small imports
wait. Use a base plus a per-byte allowance derived from the HTML length, clamped
to a sane max:

```ts
// ~10 s base, +1 s per MB of HTML, capped at 60 s. Large SingleFile captures
// (10 MB+) overran the old fixed 10 s during doc.write + layout + image decode.
const MB = 1_000_000;
const timeoutMs = Math.min(60_000, 10_000 + Math.ceil(html.length / MB) * 1_000);
```

`STABILIZE_MS` stays (the snapshot is static — no unpacking to wait for), but is
acceptable as-is.

## Wall 3 — render viewport height

Set the render iframe's height to the **measured content height** after layout,
before conversion, so `view.innerHeight` reflects the real page height and
`fixed`-element positioning is correct. Concretely: after `writeAndWait`, read
`scrollHeight`, then set `iframe.style.height` to that value and re-read rects (or
size the iframe tall from the start using a generous measured pass). Keep the
default initial height for the first layout pass; the key is that the height used
for conversion matches the content, not a hardcoded 4096.

If a clean two-pass resize proves fiddly, the minimal acceptable version is to
raise the initial `RENDER_HEIGHT` constant and document that `fixed` elements on
pages taller than it may be mispositioned — but the measured-height approach is
preferred because it removes the coupling rather than moving it.

## Unit boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `decodeImageBytes(src)` | data-URI → bytes (no fetch) / fetch fallback | `fetch`, `atob` |
| `convertToPng` | robust webp/avif/svg → PNG via `createImageBitmap` | canvas, `createImageBitmap` |
| `render-host` timeout | adaptive load timeout from HTML size | — |
| `render-host` height | conversion uses measured content height | iframe layout |

Converter node walkers, the snapshot tools, the plugin UI, and the extension are
**unchanged**.

## Error handling

- A single image that fails to decode (corrupt bytes, unknown mime) already
  falls into the per-paint skip + warning in the plugin builder; that path is
  unchanged. `decodeImageBytes`/`convertToPng` throw on failure and the existing
  cache/try-catch surfaces it as a skipped image, not a whole-import failure.
- Timeout still throws "Render timed out" if even the adaptive ceiling is
  exceeded — the user sees a clear message rather than a silent hang.

## Testing

Browser-mode vitest (the package already runs Playwright chromium with canvas):

1. `decodeImageBytes` on a `data:image/png;base64,…` returns the exact decoded
   bytes and the parsed mime, with **no** `fetch` call (spy asserts zero calls).
2. `decodeImageBytes` on an `https://…` src falls back to `fetch`.
3. `convertToPng` on a real WebP blob (a tiny fixture) produces non-empty PNG
   bytes whose header is the PNG magic (`\x89PNG`) — proving webp→PNG works via
   `createImageBitmap`.
4. `render-host` adaptive timeout: unit-test the timeout formula (pure function)
   — 0 MB → 10 s, 10 MB → 20 s, 100 MB → capped 60 s.

The height fix is verified manually (needs a real tall page with a fixed
element); no unit test asserts pixel positions.

## Out of scope

- Integrating SingleFile's code into the repo (it stays an external tool).
- Guaranteeing arbitrarily large pages (sandbox memory limits remain).
- Section-by-section / partial import (rejected in favor of removing the walls).
- Animated webp/gif frames (first frame only, as today).
