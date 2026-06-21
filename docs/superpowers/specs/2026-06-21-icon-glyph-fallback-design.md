# Per-character symbol-font fallback — design

**Date:** 2026-06-21
**Package:** `@woofigma/dom-to-figma` (text glyph pipeline)
**Status:** Approved, pending implementation

## Problem (root cause, verified)

The text pipeline renders by extracting real glyph outlines from a single loaded
font. `processSingleGlyph` (in
`packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts`)
calls `font.glyphForCodePoint(cp)`; when that returns the `.notdef` glyph
(`id === 0`) it logs `No glyph found for character` and `return null`, which
**drops the character** — the icon silently disappears.

This is a data-loss bug, not a cosmetic Figma-runtime warning: the warning text
comes from our own code, and the icon is genuinely lost.

Verified with fontkit against the shipped Inter Latin fixture: U+2315 (⌕),
U+25BE (▾), U+22EF (⋯), U+266A (♪), U+25A6 (▦) all resolve to `.notdef` in
Inter, while `A` and space are present.

## Goal

When the primary font lacks a glyph, draw it from a fallback symbol font instead
of dropping it. The icon appears; only truly-uncovered codepoints are dropped
(now rare).

## Verified fallback chain

Coverage measured with fontkit against fontsource woff2 files:

| Font (subset) | fontsource slug | covers |
| --- | --- | --- |
| Noto Sans Math (latin) | `noto-sans-math` | ▾ ⋯ ♪ ▦ (4/5) + broad math/technical/geometric |
| Noto Sans Symbols (symbols) | `noto-sans-symbols` | ⌕ (the remaining one) + dingbats/misc |

The chain `Noto Sans Math → Noto Sans Symbols` covers all 5 sample codepoints
(verified: Math supplies 4, Symbols supplies ⌕). Both load from the existing
fontsource jsDelivr CDN via the current `fontLoader`/`fontCache` — no new network
source, no CSP change.

The chain is **hardcoded** (`SYMBOL_FALLBACK_FAMILIES` constant). No public-API
option to override it (YAGNI; nobody has asked, and it's trivial to extend
later).

## Architecture (units & boundaries)

Three small, independently-testable units:

1. **`collectCodepointsMissingFromFont(loadedFont, text): Set<number>`** — pure
   helper. Returns the codepoints in `text` whose glyph is `.notdef` in the given
   loaded font. No side effects.

2. **`resolveGlyphFont(primary, fallbacks, codePoint): LoadedFont | null`** —
   pure helper. Returns `primary` if it has the glyph; otherwise the first
   fallback `LoadedFont` that has it; otherwise `null`. Returns the `LoadedFont`
   itself (not an index) so the caller takes both the glyph and its advance from
   one object. Primary always wins when it has the glyph (priority).

3. **`processSingleGlyph(..., fallbackFonts: Array<LoadedFont>)`** — gains the
   fallback list. It calls `resolveGlyphFont` to pick the font, then extracts the
   glyph path and advance from the winning font. Stays **synchronous**.

`processGlyphs` gains a `fallbackFonts: Array<LoadedFont>` parameter and forwards
it to `processSingleGlyph`. It stays synchronous.

## Data flow (converter.ts — already async)

After `const loadedFont = await fontCache.get(font)` (the primary):

1. `const missing = collectCodepointsMissingFromFont(loadedFont, text)`.
2. If `missing` is empty → `fallbackFonts = []`, no fallback load (we never load
   fallbacks when the primary covers everything).
3. If non-empty → for each family in `SYMBOL_FALLBACK_FAMILIES`, `await
   fontCache.get({ family, weight: 400, italic: false })`, collecting the
   successfully-loaded `LoadedFont`s into `fallbackFonts`.
4. `processGlyphs(loadedFont, text, options, registerBlob, fallbackFonts)`.

The scan runs **after** the primary is loaded (we need the loaded font to test
`glyphForCodePoint`). The fallback load is **conditional** on missing codepoints.

## Error handling

- A fallback font that fails to load (network/5xx/404) is **skipped** — the chain
  continues with whatever loaded. One bad fallback never fails the text node.
- A glyph present in neither the primary nor any loaded fallback → drop + the
  existing `console.warn` (last resort, now rare). This is the only path that
  drops a character.
- The existing per-node `try/catch` in `convert` still guards catastrophic
  failures.

## Trade-off (accepted)

A glyph's advance width comes from whichever font supplied it, so an icon drawn
from a fallback may have slightly different spacing than the page's CSS assumed.
Inherent to outline-extraction; the icon appearing correctly beats it vanishing.

## Files

- `…/glyph/processor.ts` — `processGlyphs`/`processSingleGlyph` gain
  `fallbackFonts`; add `resolveGlyphFont`.
- `…/glyph/` (new small module or alongside processor) —
  `collectCodepointsMissingFromFont` + `SYMBOL_FALLBACK_FAMILIES`.
- `…/nodes/text/converter.ts` — load fallbacks conditionally and pass them in.
- Test fixture: add a Noto Sans Math (and/or Symbols) woff2/ttf under
  `__fixtures__/fonts/` for browser tests.

## Testing (browser-mode, real fixtures)

1. Char missing from primary (Inter) but present in a fallback (e.g. ▾ from Noto
   Sans Math) → glyph data produced (not null), bytes non-empty.
2. Char present in primary → fallback is **not** consulted (primary used).
3. Char present in **both** primary and fallback → **primary** wins (priority
   assertion, distinct from #2).
4. Char in no font → `null` + warn (last resort).
5. The produced advance for a fallback glyph comes from the fallback font, not
   the primary.
6. Unit test for `resolveGlyphFont` ordering: primary > fallback[0] > fallback[1]
   > null.
7. Unit test for `collectCodepointsMissingFromFont`: returns exactly the
   `.notdef` codepoints, ignores covered ones and whitespace handling consistent
   with the processor.

## Out of scope

- User-configurable fallback families (hardcoded chain for now).
- Bold/italic fallback matching — fallbacks load at weight 400 normal (symbol
  glyphs are largely weight-agnostic).
- Covering every possible symbol — the long tail (e.g. private-use area) still
  drops + warns.
