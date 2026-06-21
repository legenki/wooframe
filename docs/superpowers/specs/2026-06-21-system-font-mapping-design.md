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

Keys are the output of the existing `familyToSlug` — which only strips quotes,
trims, lowercases, and collapses runs of whitespace to single hyphens. It does
**not** strip a leading hyphen. So the implementer must use these exact keys
(verified against `familyToSlug`):

- `-apple-system` keeps its **leading hyphen** (it is NOT `apple-system`).
- `BlinkMacSystemFont` → `blinkmacsystemfont`.
- `ui-monospace`, `ui-sans-serif`, `ui-serif`, `ui-rounded` pass through
  unchanged.

This must be called out in a code comment above `GENERIC_FAMILY_MAP` so nobody
"normalizes" the leading hyphen away.

| Slug(s) | Maps to |
| --- | --- |
| `sans-serif`, `ui-sans-serif`, `ui-rounded`, `system-ui`, `-apple-system`, `blinkmacsystemfont`, `cursive`, `fantasy`, `math`, `emoji` | the loader's configured `fallbackFamily` (default `Inter`) |
| `serif`, `ui-serif` | `PT Serif` |
| `monospace`, `ui-monospace` | `Roboto Mono` |

The sans-category bucket is broad on purpose: `cursive`, `fantasy`, `math`,
`emoji`, and `ui-rounded` have no good fontsource equivalent, so mapping them to
the sans fallback is strictly better than a 404 chain. They are treated exactly
like the other sans-generics (depend on `fallbackFamily`, including strict mode).

## Behavior details

- **Order:** generic-map check runs first in the loader body, before the
  `knownMissingFamilies` cache and before `fetchFromFontsource`. Generic names
  never reach the missing-family cache.
- **Strict mode (`fallbackFamily: null`):** for a sans-category generic, the
  loader checks `fallbackFamily` is set **before** delegating, and if it is
  `null` throws an explicit error naming the requested generic, e.g.
  `fontsource: "sans-serif" requires a fallbackFamily (none configured)`. We do
  NOT call `loadAsFallback(null, …)` — that would surface a confusing
  "Inter is not in the catalog"-style error instead of the real cause.
  `serif`/`monospace` map to fixed families that do **not** depend on
  `fallbackFamily`, so they still resolve in strict mode.
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
4. Every generic resolution sets `resolvedFamily` to the **mapped** family
   (e.g. `monospace` → `resolvedFamily: "Roboto Mono"`), while the *requested*
   family the loader was called with is unchanged. At the `loadFont` layer this
   means the synthesized `postScriptName` is built from the original generic
   name (e.g. `monospace-Regular`), confirming the payload claims the requested
   family, not the substitute. The loader's `FontFile` has no `requestedFamily`
   field, so this is asserted via `resolvedFamily` (loader) and the
   `LoadedFont.postScriptName` / `properties.family` (loadFont) — not an
   imagined field on `FontFile`.
5. Strict mode (`fallbackFamily: null`) throws an explicit fallback-required
   error for `sans-serif` (and the other sans-category generics) but still
   resolves `serif` → `pt-serif` and `monospace` → `roboto-mono`.
6. A non-generic, genuinely-missing family (e.g. `Verdana`) behaves exactly as
   before (existing `knownMissingFamilies` path), confirming no regression.
7. `-apple-system` (with the leading hyphen) resolves through `fallbackFamily`
   and issues zero fetches to any `-apple-system` / `apple-system` URL —
   guarding the slug-key correctness from review item #2.

## Follow-up (out of scope)

Once landed, update the "System fonts 404 on the CDN" bullet in the plugin and
root READMEs to reflect that the noise is resolved.
