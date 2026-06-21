# System / generic font-name pre-mapping

**Date:** 2026-06-21
**Package:** `@woofigma/dom-to-figma`
**Status:** Approved, pending implementation

## Problem

When a CSS font stack leads with a system or generic family name —
`ui-monospace`, `-apple-system`, `system-ui`, `sans-serif`, `monospace`,
`serif`, etc. — `createFontsourceLoader` passes that name through
`buildFallbackChain` and issues 2–3 `fetch` requests to jsDelivr's fontsource
CDN, each of which 404s (fontsource mirrors Google Fonts only; it carries no
system fonts), before `loadAsFallback` substitutes Inter.

Those 404s are harmless to the output — text still renders via the Inter
fallback — but they produce console noise on every page that uses a system font
stack, which is most of them. This was logged as a known limitation in the
plugin and root READMEs.

## Goal

Eliminate the doomed CDN requests for known generic/system family names by
resolving them to a real fontsource family **before** any fetch, while
preserving the existing substitution semantics (the Figma payload keeps the
*requested* family name so Figma resolves the real system font at paste time).

Non-goals: walking the full font-family stack (we keep first-name-only parsing),
and changing `parseFontFamily`.

## Approach

Add a static **generic-name → fontsource-family map** consulted inside
`createFontsourceLoader`, in the returned loader function, **before**
`fetchFromFontsource` and before the `knownMissingFamilies` cache check.

When the requested family (normalized through the existing `familyToSlug`) is a
known generic, resolve it by delegating to the existing
`loadAsFallback(mappedFamily, request, subset)`. That path already:

- fetches the mapped family from fontsource,
- sets `resolvedFamily` on the returned `FontFile`, so `loadFont` synthesizes
  the postScriptName from the **requested** family (e.g. keeps `monospace`'s
  semantics by claiming the original name), and
- reuses the weight/italic fallback chain for the mapped family.

Net effect: zero CDN requests are ever made for the generic name itself.

## The map

Keyed by `familyToSlug(family)` output (lowercased, quotes stripped, spaces →
hyphens):

| Slug(s) | Maps to |
| --- | --- |
| `sans-serif`, `ui-sans-serif`, `system-ui`, `-apple-system`, `blinkmacsystemfont`, `cursive`, `fantasy` | the loader's configured `fallbackFamily` (default `Inter`) |
| `serif`, `ui-serif` | `PT Serif` |
| `monospace`, `ui-monospace` | `Roboto Mono` |

`cursive`/`fantasy` have no good category equivalent on fontsource, so they map
to the sans fallback.

## Behavior details

- **Order:** generic-map check runs first in the loader body, before the
  `knownMissingFamilies` cache and before `fetchFromFontsource`. Generic names
  never reach the missing-family cache.
- **Strict mode (`fallbackFamily: null`):** generic names that map to
  `fallbackFamily` throw the same "not in the catalog" error as today (there is
  no family to resolve to). `serif`/`monospace` map to fixed families that do
  **not** depend on `fallbackFamily`, so they still resolve in strict mode.
- **`resolvedFamily`** is set on every generic resolution, so the payload always
  keeps the original requested family name. No new payload code path.
- **Custom `fallbackFamily`:** sans-category generics follow the configured
  value, honoring the existing option contract.

## Files touched

`packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts`
only — add a `GENERIC_FAMILY_MAP` constant plus a short-circuit branch in the
loader returned by `createFontsourceLoader`. No changes to `parseFontProperties`
/ `parseFontFamily`.

## Testing

New browser-mode test file alongside the loader. `fetch` is mocked (spied) so we
assert on requested URLs without hitting jsDelivr:

1. A `monospace` request issues exactly one fetch to the `roboto-mono` URL and
   **zero** fetches to any `monospace` URL.
2. A `sans-serif` request resolves through `fallbackFamily` (default `inter`).
3. A `serif` request resolves to `pt-serif`.
4. Every generic resolution sets `resolvedFamily` so the payload keeps the
   original requested family.
5. Strict mode (`fallbackFamily: null`) throws for `sans-serif` but still
   resolves `serif` to `pt-serif`.
6. A non-generic, genuinely-missing family (e.g. `Verdana`) behaves exactly as
   before (existing `knownMissingFamilies` path), confirming no regression.

## Follow-up (out of scope)

Once landed, update the "System fonts 404 on the CDN" bullet in the plugin and
root READMEs to reflect that the noise is resolved.
