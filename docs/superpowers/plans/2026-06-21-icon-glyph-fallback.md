# Per-character symbol-font fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the primary font lacks a glyph (icon symbols like ⌕ ▾ ⋯ ♪ ▦ that Inter lacks), draw it from a hardcoded fallback chain (Noto Sans Math → Noto Sans Symbols) instead of dropping the character.

**Architecture:** Two pure helpers — `collectCodepointsMissingFromFont(loadedFont, text)` and `resolveGlyphFont(primary, fallbacks, codePoint)` — plus a `fallbackFonts` parameter threaded into `processGlyphs`/`processSingleGlyph`. `converter.ts` (already async) loads the fallback chain via the existing `fontCache`, but only when the primary font is missing codepoints. `processGlyphs` stays synchronous. A glyph in no font drops + warns as today.

**Tech Stack:** TypeScript, Vitest browser-mode (`*.browser.test.ts`), fontkit. Fallback fonts load through the existing `fontLoader`/`fontCache` (fontsource jsDelivr). Test uses a bundled Noto Sans Math woff2 fixture.

---

## File Structure

- **Modify** `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts` — add `collectCodepointsMissingFromFont`, `resolveGlyphFont`, `SYMBOL_FALLBACK_FAMILIES`; thread `fallbackFonts` through `processGlyphs` → `processSingleGlyph`.
- **Modify** `packages/dom-to-figma/src/converter/nodes/text/converter.ts` — after loading the primary, collect missing codepoints, conditionally load the fallback chain, pass `fallbackFonts` into `processGlyphs`.
- **Add fixture** `packages/dom-to-figma/src/__fixtures__/fonts/noto-sans-math-latin-400.woff2` — already staged in the working tree from design research (covers ▾ U+25BE, ⋯ U+22EF; Inter does not). Just `git add` it.
- **Test** `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.browser.test.ts` (new).

Order: pure helpers + glyph selection first (Tasks 1–2, fully unit/browser testable in isolation), then wire the converter (Task 3).

---

## Task 1: `resolveGlyphFont` + `collectCodepointsMissingFromFont` helpers

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts`
- Test: `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.browser.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `processor.browser.test.ts`. It loads the real Inter and Noto Sans Math
fixtures through `loadFont` so `glyphForCodePoint` is exercised on real fonts:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import interUrl from "../../../../../__fixtures__/fonts/inter-latin-400.ttf?url";
import mathUrl from "../../../../../__fixtures__/fonts/noto-sans-math-latin-400.woff2?url";
import { loadFont } from "../font";
import type { LoadedFont } from "../font";
import {
  collectCodepointsMissingFromFont,
  resolveGlyphFont,
} from "./processor";

const props = { family: "X", weight: 400, italic: false };

async function load(url: string): Promise<LoadedFont> {
  const bytes = await (await fetch(url)).arrayBuffer();
  return loadFont(async () => ({ bytes }), props);
}

let inter: LoadedFont;
let math: LoadedFont;

beforeAll(async () => {
  inter = await load(interUrl);
  math = await load(mathUrl);
});

describe("collectCodepointsMissingFromFont", () => {
  it("returns codepoints absent from the font, ignoring covered ones", () => {
    // ▾ U+25BE is absent from Inter; 'A' is present.
    const missing = collectCodepointsMissingFromFont(inter, "A▾");
    expect(missing.has(0x25be)).toBe(true);
    expect(missing.has(0x41)).toBe(false);
  });
});

describe("resolveGlyphFont", () => {
  it("returns the primary when it has the glyph", () => {
    expect(resolveGlyphFont(inter, [math], 0x41)).toBe(inter);
  });

  it("returns the first fallback that has the glyph", () => {
    // ▾ U+25BE: absent in Inter, present in Math.
    expect(resolveGlyphFont(inter, [math], 0x25be)).toBe(math);
  });

  it("prefers the primary even when a fallback also has the glyph", () => {
    // 'A' exists in both; primary wins.
    expect(resolveGlyphFont(inter, [math], 0x41)).toBe(inter);
  });

  it("returns null when no font has the glyph", () => {
    // U+E000 (private use) is in neither fixture.
    expect(resolveGlyphFont(inter, [math], 0xe000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser processor.browser.test.ts`
Expected: FAIL — `collectCodepointsMissingFromFont` / `resolveGlyphFont` are not exported.

- [ ] **Step 3: Add the helpers + constant to processor.ts**

At the top of `processor.ts` (after the imports), add the constant and two pure
helpers:

```ts
/**
 * Symbol fonts (fontsource families) tried in order when the primary font lacks
 * a glyph. Coverage verified with fontkit: Math supplies most geometric/
 * technical/math symbols; Symbols supplies the rest (e.g. U+2315). Loaded at
 * weight 400 normal — symbol glyphs are largely weight-agnostic.
 */
export const SYMBOL_FALLBACK_FAMILIES = ["Noto Sans Math", "Noto Sans Symbols"];

/**
 * Codepoints in `text` whose glyph is `.notdef` (id 0) in the given font.
 * Pure: no side effects. Whitespace is treated like any other character; the
 * caller already handles space specially downstream.
 */
export function collectCodepointsMissingFromFont(
  loadedFont: LoadedFont,
  text: string
): Set<number> {
  const missing = new Set<number>();
  for (const char of new Set(text)) {
    const cp = char.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    if (loadedFont.font.glyphForCodePoint(cp).id === 0) {
      missing.add(cp);
    }
  }
  return missing;
}

/**
 * Pick the font to draw a codepoint from: the primary if it has the glyph,
 * else the first fallback that does, else null. Returns the LoadedFont itself
 * so the caller takes both the glyph and its advance from one object. Pure.
 */
export function resolveGlyphFont(
  primary: LoadedFont,
  fallbacks: Array<LoadedFont>,
  codePoint: number
): LoadedFont | null {
  if (primary.font.glyphForCodePoint(codePoint).id !== 0) {
    return primary;
  }
  for (const fallback of fallbacks) {
    if (fallback.font.glyphForCodePoint(codePoint).id !== 0) {
      return fallback;
    }
  }
  return null;
}
```

The file already imports `LoadedFont` (from `../font`) — confirm the import line
`import type { ..., LoadedFont } from "../font";` exists; the processor uses
`LoadedFont` in `processGlyphs` already, so it does.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser processor.browser.test.ts`
Expected: PASS (5 assertions across the two describes).

- [ ] **Step 5: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts \
        packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.browser.test.ts \
        packages/dom-to-figma/src/__fixtures__/fonts/noto-sans-math-latin-400.woff2
git commit -m "feat(dom-to-figma): add glyph-font resolution helpers + Math fixture"
```

---

## Task 2: Use the fallback font in `processSingleGlyph`

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts`
- Test: `packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.browser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `processor.browser.test.ts`:

```ts
import { processGlyphs } from "./processor";

describe("processGlyphs with fallback fonts", () => {
  const blobs: Array<{ bytes: Array<number> }> = [];
  const register = (b: { bytes: Array<number> }) => {
    blobs.push(b);
    return blobs.length - 1;
  };

  it("produces a glyph for a char missing from primary but in a fallback", () => {
    // ▾ U+25BE: absent in Inter, present in Math.
    const out = processGlyphs(
      inter,
      "▾",
      { fontSize: 16, includeWhitespace: false },
      register,
      [math]
    );
    const data = out.glyphDataMap.get("▾");
    expect(data).toBeDefined();
    expect(data?.bytes.length).toBeGreaterThan(1);
    // Advance comes from Math (the font that supplied the glyph), so it is the
    // Math glyph's advance, which is non-zero.
    expect(data?.advance).toBeGreaterThan(0);
  });

  it("drops a char present in no font and produces no entry", () => {
    const out = processGlyphs(
      inter,
      "",
      { fontSize: 16, includeWhitespace: false },
      register,
      [math]
    );
    expect(out.glyphDataMap.has("")).toBe(false);
  });

  it("still maps a normal char from the primary with no fallbacks", () => {
    const out = processGlyphs(
      inter,
      "A",
      { fontSize: 16, includeWhitespace: false },
      register,
      []
    );
    expect(out.glyphDataMap.get("A")?.bytes.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser processor.browser.test.ts`
Expected: FAIL — `processGlyphs` ignores the 5th arg; ▾ still resolves to
`.notdef` in Inter and the char is dropped (`data` undefined).

- [ ] **Step 3: Thread `fallbackFonts` through processGlyphs/processSingleGlyph**

In `processor.ts`, change `processGlyphs` to accept and forward `fallbackFonts`
(default `[]` so existing callers/tests keep working):

```ts
export function processGlyphs(
  loadedFont: LoadedFont,
  text: string,
  options: GlyphProcessingOptions,
  registerBlob: (blob: FigmaBlob) => number,
  fallbackFonts: Array<LoadedFont> = []
): ProcessedGlyphs {
```

Inside the per-char loop, pass the primary + fallbacks down:

```ts
    const glyphData = processSingleGlyph(
      loadedFont,
      char,
      fontSize,
      registerBlob,
      fallbackFonts
    );
```

Change `processSingleGlyph` to take the primary `LoadedFont` (so it has both font
and metrics) plus `fallbackFonts`, and resolve the font per character:

```ts
function processSingleGlyph(
  primary: LoadedFont,
  char: string,
  fontSize: number,
  registerBlob: (blob: FigmaBlob) => number,
  fallbackFonts: Array<LoadedFont>
): GlyphData | null {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return null;
  }

  const chosen =
    char === " " ? primary : resolveGlyphFont(primary, fallbackFonts, codePoint);
  if (chosen === null) {
    console.warn(
      `No glyph found for character: '${char}' (U+${codePoint.toString(16).toUpperCase()})`
    );
    return null;
  }
  const font = chosen.font;
  const metrics = chosen.metrics;
  const glyph = font.glyphForCodePoint(codePoint);

  if (char === " ") {
    return createSpaceGlyph(
      char,
      glyph,
      fontSize,
      metrics.unitsPerEm,
      registerBlob
    );
  }

  const glyphBytes = pathCommandsToGlyphBytes(glyph.path.commands, {
    unitsPerEm: metrics.unitsPerEm,
  });

  if (glyphBytes.length <= 1) {
    console.warn(`Empty path for character: '${char}'`);
    return null;
  }

  const registeredBlobIndex = registerBlob({ bytes: glyphBytes });
  const advance = calculateAdvanceWidth(glyph, fontSize, metrics.unitsPerEm);

  return {
    character: char,
    unicode: codePoint,
    bytes: glyphBytes,
    advance,
    registeredBlobIndex,
  };
}
```

Note: `processSingleGlyph`'s previous `font`/`metrics` params are replaced by the
`primary` LoadedFont (+ fallbacks). `processGlyphs` no longer destructures
`const { font, metrics } = loadedFont;` for this call — remove that destructure
if it becomes unused, or leave `metrics`/`font` if still referenced elsewhere in
`processGlyphs` (it is not; the only use was this call — remove the now-unused
locals to satisfy lint).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser processor.browser.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Typecheck + run the package's browser suite**

Run: `pnpm --filter @woofigma/dom-to-figma check-types && pnpm --filter @woofigma/dom-to-figma exec vitest run --project browser`
Expected: PASS. (If `check-types` flags the removed `font`/`metrics` locals in
`processGlyphs`, delete the now-unused `const { font, metrics } = loadedFont;`
line.)

- [ ] **Step 6: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts \
        packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.browser.test.ts
git commit -m "feat(dom-to-figma): draw missing glyphs from fallback fonts"
```

---

## Task 3: Load the fallback chain in the text converter

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/text/converter.ts`

- [ ] **Step 1: Add the conditional fallback load and pass it to processGlyphs**

In `converter.ts`, replace the existing `processGlyphs(loadedFont, text, …)`
call region (around lines 281–289) with a block that loads fallbacks only when
the primary is missing codepoints:

```ts
  const missingCodepoints = collectCodepointsMissingFromFont(loadedFont, text);
  const fallbackFonts: Array<LoadedFont> = [];
  if (missingCodepoints.size > 0) {
    for (const family of SYMBOL_FALLBACK_FAMILIES) {
      try {
        fallbackFonts.push(
          await fontCache.get({ family, weight: 400, italic: false })
        );
      } catch {
        // A fallback that fails to load (network/404) is skipped; the chain
        // continues. One bad fallback never fails the text node.
      }
    }
  }

  const glyphs = processGlyphs(
    loadedFont,
    text,
    {
      fontSize: styles.fontSize,
      includeWhitespace: true,
    },
    registerBlob,
    fallbackFonts
  );
```

- [ ] **Step 2: Add the imports**

At the top of `converter.ts`, extend the import from the glyph processor to
include the new helpers. Find the existing
`import { processGlyphs } from "./primitives/glyph/processor";` and replace with:

```ts
import {
  collectCodepointsMissingFromFont,
  processGlyphs,
  SYMBOL_FALLBACK_FAMILIES,
} from "./primitives/glyph/processor";
```

`converter.ts` has no existing import from `./primitives/font`, so add a fresh
type import for the `fallbackFonts` annotation (`LoadedFont` is re-exported from
`./primitives/font`'s index):

```ts
import type { LoadedFont } from "./primitives/font";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @woofigma/dom-to-figma check-types`
Expected: PASS.

- [ ] **Step 4: Run the full package suite**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run`
Expected: PASS (unit + browser; no regressions in existing text tests).

- [ ] **Step 5: Lint**

Run: `pnpm exec biome check packages/dom-to-figma/src/converter/nodes/text/converter.ts packages/dom-to-figma/src/converter/nodes/text/primitives/glyph/processor.ts`
Expected: no errors (infos/warnings are non-blocking).

- [ ] **Step 6: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/converter.ts
git commit -m "feat(dom-to-figma): load symbol fallback fonts for missing glyphs"
```

---

## Task 4: Update the README limitation note

**Files:**
- Modify: `apps/plugin/README.md`

- [ ] **Step 1: Update the plugin README**

In `apps/plugin/README.md`, the Scope section currently ends with: `Not yet
handled: per-character icon-font glyph coverage, and deriving gradient direction
from the CSS angle.` Replace with:

```markdown
Images build via `figma.createImage` (PNG; a failed image keeps its frame and
records a warning). Icon/symbol characters the primary font lacks (e.g. ⌕ ▾ ⋯)
are drawn from a fallback chain (Noto Sans Math → Noto Sans Symbols) instead of
being dropped. Not yet handled: deriving gradient direction from the CSS angle.
```

- [ ] **Step 2: Verify the icon-coverage TODO is gone**

Run: `grep -rn "icon-font glyph" apps/plugin/README.md README.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add apps/plugin/README.md
git commit -m "docs: note icon/symbol glyph fallback"
```

---

## Self-Review

- **Spec coverage:** `collectCodepointsMissingFromFont` (Task 1) ✓;
  `resolveGlyphFont` returns LoadedFont, primary-priority (Task 1, tests incl.
  priority #3) ✓; `processSingleGlyph` picks per-char font, advance from winning
  font (Task 2, advance test) ✓; `processGlyphs` stays sync with `fallbackFonts`
  param (Task 2) ✓; converter loads chain conditionally after primary, skips bad
  fallback (Task 3) ✓; hardcoded `SYMBOL_FALLBACK_FAMILIES` (Task 1) ✓; last
  resort drop+warn (Task 2, "drops a char present in no font") ✓; README (Task 4)
  ✓.
- **Placeholders:** none — all code concrete.
- **Type consistency:** `resolveGlyphFont(primary, fallbacks, codePoint):
  LoadedFont | null`, `collectCodepointsMissingFromFont(loadedFont, text):
  Set<number>`, `processGlyphs(..., fallbackFonts: Array<LoadedFont> = [])`, and
  `processSingleGlyph(primary, char, fontSize, registerBlob, fallbackFonts)` are
  consistent across Tasks 1–3. `SYMBOL_FALLBACK_FAMILIES` referenced identically
  in Task 1 (def) and Task 3 (use).
- **Note on processSingleGlyph signature change:** the old signature was
  `(font, char, metrics, fontSize, registerBlob)`. Task 2 changes it to
  `(primary, char, fontSize, registerBlob, fallbackFonts)` — only `processGlyphs`
  calls it (internal), so no external caller breaks. Verified: the only call site
  is inside `processGlyphs`.
