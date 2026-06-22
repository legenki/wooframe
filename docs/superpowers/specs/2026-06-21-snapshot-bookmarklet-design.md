# Snapshot bookmarklet — design

**Date:** 2026-06-21
**Package:** `apps/plugin` (new `bookmarklet/` artifact; plugin code unchanged)
**Status:** Approved, pending implementation

## Problem

Load-from-URL via a public CORS proxy can't reach private/authenticated SPAs:
the proxy isn't logged in, and it returns server HTML (a pre-JS shell), not the
rendered page. A bookmarklet runs **in the user's own tab** — it sees the final,
post-JS DOM under the user's session — so it captures exactly what the user sees,
bypassing both CORS and the SPA-render problem.

## How it works

The bookmarklet, run on the target page by clicking it:

1. Clones `document.documentElement`.
2. Walks the original and the clone in lockstep (recursive `children` traversal,
   element nodes only). For each clone element, writes a `style=""` containing a
   **curated whitelist** of CSS properties (see below), read from the original
   element's `getComputedStyle`.
3. Removes `<script>` and `<noscript>` from the clone.
4. Serializes `<!doctype html>` + the clone's `outerHTML`.
5. **Delivers via both channels:** builds a `Blob` and triggers a download of
   `woofigma-snapshot.html`, **and** attempts `navigator.clipboard.writeText`
   (best-effort; ignored if blocked).
6. Shows a small fixed-position toast: `Processing N elements…` during the walk,
   then `Snapshot saved — drop the .html into Woofigma (or paste).`.

The user then drops the `.html` into the plugin (or pastes) — existing flows,
unchanged.

## Style inlining

### The whitelist

Inline only the CSS properties the converter actually reads (extracted from
`packages/dom-to-figma/src/converter`). Inlining all ~450 computed longhands
would produce ~19 MB on a 2000-element page and add nothing — the converter
ignores the rest. The whitelist (~55 props) keeps a 2000-element snapshot near
~1.7 MB with zero loss of fidelity.

The set, grouped:

- Text: `color`, `font-family`, `font-size`, `font-style`, `font-weight`,
  `line-height`, `letter-spacing`, `word-spacing`, `text-align`,
  `text-decoration-line`, `text-transform`, `white-space`.
- Box / background: `background`, `background-color`, `background-image`,
  `background-clip`, `opacity`, `display`, `position`, `overflow`, `overflow-x`,
  `overflow-y`, `box-shadow`, `filter`, `backdrop-filter`, `clip`.
- Padding: `padding`, `padding-top`, `padding-right`, `padding-bottom`,
  `padding-left`.
- Border + radius: `border-width`, `border-color`, `border-top-width`,
  `border-right-width`, `border-bottom-width`, `border-left-width`,
  `border-top-color`, `border-right-color`, `border-bottom-color`,
  `border-left-color`, `border-top-left-radius`, `border-top-right-radius`,
  `border-bottom-left-radius`, `border-bottom-right-radius`.
- SVG: `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`,
  `stroke-opacity`, `stroke-dasharray`, `stroke-linecap`, `stroke-linejoin`,
  `clip-rule`.

**Maintenance — enforced by a guard test, not just a comment (this is the
design's main long-term risk, so it gets a mechanism):**

The whitelist lives as a single named constant array (`SNAPSHOT_STYLE_PROPS`) at
the top of `snapshot.js`, with a comment pointing at the converter. But comments
rot, so a **guard test** mechanically enforces the sync:

- A test (`snapshot-whitelist.test.ts`, node project) walks
  `packages/dom-to-figma/src/converter/**/*.ts` (excluding `.test.ts`), extracts
  every property the converter reads — `computedStyle.fooBar` (camel→kebab) and
  `getPropertyValue("foo-bar")` — into a set, and asserts that set is a
  **subset** of `SNAPSHOT_STYLE_PROPS`.
- If the converter starts reading a property the whitelist lacks, the test fails
  with the missing property name → the snapshot would silently drop it, so the
  build goes red until the whitelist is updated.
- The extraction is verified deterministic: it currently yields exactly the 55
  properties listed below. The assertion is subset (converter ⊆ whitelist), not
  equality, so the whitelist may intentionally carry a few extra props (e.g.
  shorthand `padding`/`border-width` alongside longhands) without failing.

This converts "remember to update the whitelist" from discipline into a CI gate.

### Specificity / ordering

Write the whitelisted **computed** values into `style=""`. Do **not** re-append
the element's original inline `style` on top — `getComputedStyle` already
incorporates the original inline style (inline is part of the cascade computed
value), so the computed value is the final, correct one. Re-appending would be
redundant and could even duplicate or conflict. The clone's serialized `style`
therefore contains exactly the whitelisted computed values.

## DOM traversal

- Recursive walk over `element.children` (element nodes only); text nodes are
  carried by `outerHTML` and need no per-node styling.
- **Shadow DOM:** not traversed. If an element has a `shadowRoot`, it is skipped
  (its light children are still walked); the snapshot must not throw on
  shadow hosts. Documented as a limitation.
- **Pseudo-elements** (`::before` / `::after`): not captured. The converter does
  not render them, so there's nothing to gain. Documented.

## Files

- `apps/plugin/bookmarklet/snapshot.js` — readable, commented source (the
  function under test); exports `SNAPSHOT_STYLE_PROPS` and the inlining function
  for the tests.
- `apps/plugin/bookmarklet/snapshot-whitelist.test.ts` — the guard test that
  diffs the converter's read-set against `SNAPSHOT_STYLE_PROPS` (node project).
- `apps/plugin/bookmarklet/snapshot.bookmarklet.txt` — the ready-to-paste,
  minified `javascript:` one-liner.
- `apps/plugin/bookmarklet/README.md` — short local instructions: how to install
  the bookmarklet (drag the link to the bookmarks bar, or create a bookmark with
  the `javascript:` string), how to use it, how to regenerate the minified
  string, and the limitations.
- Plugin app/render-host/converter: **unchanged** — the snapshot enters through
  the existing file-drop / paste path.

## Error handling

- `clipboard.writeText` may reject (no user-gesture/permission) — caught and
  ignored; the download still fires.
- Shadow hosts / unusual nodes must not throw the walk (guarded).
- Very large pages → a multi-MB `.html` and a 1–3 s walk (per the toast); this
  is acceptable for a one-shot tool and is noted in the README.

## Testing

Browser-mode vitest (matches the package's DOM tests), testing the inlining
function from `snapshot.js` against a constructed DOM:

1. Whitelisted properties (e.g. `color`, `padding-top`) appear in the element's
   `style`.
2. A non-whitelisted property (e.g. `cursor`, `z-index`) does **not** appear in
   `style` — guards the size/whitelist contract.
3. `<script>` and `<noscript>` are removed from the output.
4. The output is a full HTML document beginning with `<!doctype html>`.
5. A page containing a `::before` pseudo-element and a web-component with a
   `shadowRoot` does **not** throw — the walk completes and ignores them.
6. **Whitelist guard** (`snapshot-whitelist.test.ts`, node): extract the
   converter's read CSS properties from `packages/dom-to-figma/src/converter` and
   assert they are all present in `SNAPSHOT_STYLE_PROPS`. Fails (naming the
   missing property) if the converter starts reading something the whitelist
   lacks.

The minification / `javascript:` wrapping is not tested (trivial transform).

## Out of scope

- Capturing Shadow DOM, `<canvas>`/WebGL, `<video>`, cross-origin `<iframe>`.
- Capturing pseudo-elements.
- Auto-installing the bookmarklet (manual, one-time).
- Any change to the plugin UI or converter.
