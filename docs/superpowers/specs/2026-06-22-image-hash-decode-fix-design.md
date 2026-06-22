# Fix image processing in the Figma iframe — design

**Date:** 2026-06-22
**Package:** `@woofigma/dom-to-figma` (image loader only)
**Status:** Approved, pending implementation

## Problem (verified from live Figma console)

After the data-URI/createImageBitmap fix, images reach processing and expose two
errors in the plugin UI iframe, both in `image/loader.ts`, both aborting the
image node:

1. **`TypeError: Cannot read properties of undefined (reading 'digest')`** (~70×,
   dominant). `sha1` calls `crypto.subtle.digest`. `crypto.subtle` (SubtleCrypto)
   is unavailable in the Figma plugin UI iframe (not a secure context), so every
   decoded image dies at the hash step → black.
2. **`InvalidStateError: The source image could not be decoded`** (~12×).
   `createImageBitmap` can't decode some sources — primarily AVIF (8 on this
   page) and a few malformed data-URIs.

Note: the plugin builder uses Figma's own `image.hash` from `figma.createImage`,
not the converter's `sha1` — but the converter's `sha1` still throws and crashes
the image node before its bytes can be used. The clipboard path does embed the
converter hash, so it must remain a real SHA-1.

## Solution

### Fix A — pure-JS SHA-1 (the main fix)

Replace `crypto.subtle.digest("SHA-1", …)` with a self-contained pure-JS SHA-1.
Always pure-JS (no `crypto.subtle` branch) so it works identically in the Figma
sandbox, node, and browser tests.

- New unit **`sha1Bytes(bytes: Uint8Array): Array<number>`** — a standard
  ~40-line SHA-1 producing the **20-byte digest as `Array<number>`** (the exact
  same output shape the current `crypto.subtle` path returns — a byte array, NOT
  a hex string), so the clipboard `image.hash` format is unchanged.
- `sha1(buffer)` becomes a thin wrapper: `sha1Bytes(new Uint8Array(buffer))`. It
  can be synchronous now (no async crypto), but keeping `processImageFile` async
  is fine; the wrapper just returns the array.

### Fix B — isolate undecodable images

`convertToPng` already throws on a decode failure; the requirement is that this
throw is **isolated to the one image**, not fatal to the import. The plugin
builder's per-paint try/catch (`mapImagePaint`) already skips a failing image
with a warning, and the converter's per-node try/catch guards the rest. Confirm
`convertToPng`'s `InvalidStateError` propagates cleanly (it does — `await
createImageBitmap(blob)` rejects, the error bubbles to the caller's catch). No
new swallowing inside `convertToPng`; the fix is simply that, with Fix A in
place, only genuinely-undecodable images (AVIF) are skipped instead of *all*
images dying at the hash.

## Unit boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `sha1Bytes(bytes)` | pure-JS SHA-1 → 20-byte `Array<number>` | none (no Web Crypto) |
| `sha1(buffer)` | wrapper over `sha1Bytes` | `sha1Bytes` |
| `convertToPng` | decode + re-encode; rejects on undecodable | `createImageBitmap`, canvas |

`processImageFile`, `decodeImageBytes`, `createDirectImageLoader`,
`FIGMA_SUPPORTED_FORMATS` unchanged. Converter walkers, plugin builder, and
snapshot tools are untouched.

## Testing

`loader.browser.test.ts` (browser project; the canvas/createImageBitmap tests
already live here) plus the pure hash can also be asserted in any env:

1. **SHA-1 correctness vector:** `sha1Bytes(utf8("abc"))` equals the known digest
   `a9 99 3e 36 47 06 81 6a ba 3e 25 71 78 50 c2 6c 9c d0 d8 9d` (as a 20-number
   array). Proves the pure-JS implementation matches the standard.
2. **No crypto.subtle dependency:** with `vi.stubGlobal("crypto", {})` (so
   `crypto.subtle` is undefined), `processImageFile` on a valid PNG still returns
   a 20-byte `hash` and bytes — reproduces the Figma-iframe condition and proves
   the fix.
3. **Undecodable image isolation:** `processImageFile` on a non-image blob
   (`mimeType: "image/avif"`, garbage bytes) rejects with an error (caller
   skips), rather than hanging.

## Out of scope

- Decoding AVIF that the Figma iframe can't decode (those images are skipped with
  a warning; webp/png/jpeg — the majority — now work).
- Memory limits on very large captures (unchanged; the sandbox cap remains).
- Any change to the snapshot tools, plugin UI, or converter node walkers.
