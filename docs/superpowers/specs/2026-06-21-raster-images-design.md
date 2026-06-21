# Raster image fills in the plugin — design

**Date:** 2026-06-21
**Package:** `apps/plugin` (the converter is unchanged)
**Status:** Approved, pending implementation

## Problem

`@woofigma/dom-to-figma` already converts `<img>` elements: each becomes a
`ROUNDED_RECTANGLE` node with an `IMAGE` fill paint, and the decoded PNG bytes
are stored in `result.document.blobs`, referenced from the paint by
`image.dataBlob` (an index into that blob array).

The plugin builder never receives the blobs and doesn't handle IMAGE paints, so
imported pages drop their raster images. This is the last open V1 limitation.

## Goal

Make the plugin build real Figma images for `<img>` elements, using
`figma.createImage`, without changing the converter.

## Verified API facts (`@figma/plugin-typings`)

- `createImage(data: Uint8Array): Image` — **synchronous**, takes a
  `Uint8Array`, returns `Image`.
- `Image.hash: string | null`.
- Canonical fill: `{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }`
  (`ImagePaint.scaleMode` is `'FILL' | 'FIT' | 'CROP' | 'TILE'`; the converter
  only emits `FILL`).

Because `createImage` is synchronous, `mapPaints` stays synchronous — no async
changes ripple through the builder.

## Data flow

1. **`render-host.ts`** — alongside `nodeChanges`, read `result.document.blobs`
   and return them in `RenderResult` (`blobs: Array<{ bytes: Uint8Array }>`).
2. **`messages.ts`** — the `import-nodes` (`UiToCode`) message gains `blobs:
   Array<{ bytes: Uint8Array }>` (it currently carries `nodeChanges` +
   `rootName`).
3. **`code.ts`** — pass `msg.blobs` into `buildNodes`.
4. **`build-nodes.ts`** — thread `blobs` (and the existing `warnings` array)
   into `applyFrame` → `mapPaints`.
5. **`paint-mapper.ts`** — add an IMAGE branch: look up
   `blobs[paint.image.dataBlob].bytes`, call `figma.createImage(bytes)`, and emit
   `{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }`.

## Node type

Keep `figma.createFrame()` for image nodes (Frame + IMAGE fill). The converter's
`ROUNDED_RECTANGLE` carries `cornerRadius`, which `applyFrame` already applies,
so rounded images work with no extra code. No `createRectangle` branch.

## Error handling

Per-paint, not per-node. `figma.createImage` can throw on corrupt/unsupported
bytes:

- On throw → skip just the image fill; the frame (size, corner radius, other
  fills) is still built. Append `image fill skipped: <reason>` to
  `summary.warnings`.
- If `paint.image.dataBlob` is `undefined` or indexes past `blobs` → same: skip
  the fill, append a warning.

Other nodes are unaffected. This matches the existing per-node `try/catch`
philosophy in `buildNodes`, one level finer.

## Signature shape

To avoid a sprawling parameter list, `mapPaints` takes a small context:

```ts
type PaintContext = {
  blobs: Array<{ bytes: Uint8Array }>;
  warnings: Array<string>;
};
mapPaints(paints, ctx): Array<Paint>
```

`applyFrame` receives `blobs` + `warnings` and forwards the context. SOLID and
GRADIENT_LINEAR branches ignore the context (unchanged behavior).

## Files

- `apps/plugin/src/ui/render-host.ts` — surface `blobs` in `RenderResult`.
- `apps/plugin/src/messages.ts` — add `blobs` to the BUILD message.
- `apps/plugin/src/code.ts` — pass `blobs` to `buildNodes`.
- `apps/plugin/src/builder/build-nodes.ts` — thread `blobs`/`warnings` to
  `applyFrame`/`mapPaints`.
- `apps/plugin/src/builder/paint-mapper.ts` — IMAGE branch + context param.
- `apps/plugin/src/builder/figma-mock.ts` — add a `createImage` stub for tests.

The converter (`@woofigma/dom-to-figma`) is **not** touched.

## Testing

`paint-mapper` / `build-nodes` unit tests with a mocked `figma.createImage`
(returns `{ hash: 'img-hash' }`):

1. A valid IMAGE paint (`dataBlob` → real blob) produces a fill
   `{ type: 'IMAGE', imageHash: 'img-hash', scaleMode: 'FILL' }`, and
   `createImage` is called with the blob's exact bytes.
2. `createImage` throwing → no image fill emitted, the node is still built, and a
   warning is recorded.
3. A `dataBlob` index with no matching blob → fill skipped, warning recorded.
4. End-to-end via `buildNodes`: a `ROUNDED_RECTANGLE` change with an IMAGE paint
   and a matching blob yields a frame whose `fills` contains the IMAGE paint.

## Out of scope

- `scaleMode` other than `FILL` (converter only emits FILL).
- Re-encoding/format handling (the converter already normalizes to PNG).
- `imageThumbnail` / `thumbHash` (the converter leaves them unset).
