# Full-fidelity snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the snapshot inline all computed styles (minus a small blacklist) so a re-rendered snapshot lays out identically to the original page and the converter measures correct geometry.

**Architecture:** Replace `inlineStyles`'s fixed whitelist loop with iteration over the element's `getComputedStyle` declaration, skipping a `SNAPSHOT_SKIP_PROPS` blacklist. The lockstep `(original, clone, getStyle)` signature is kept — styles are written onto the clone, never the live page. The guard test flips from "converter props ⊆ whitelist" to "converter props ∩ blacklist = ∅". Bundles (bookmarklet `.txt`, extension `content.js`) are regenerated; the plugin/converter are untouched.

**Tech Stack:** JS, Vitest (happy-dom for the inline test with a DI iterable style-stub; node for the guard test), esbuild for the regenerated bundles.

---

## File Structure

- **Modify** `apps/plugin/bookmarklet/snapshot.js` — replace `SNAPSHOT_STYLE_PROPS` with `SNAPSHOT_SKIP_PROPS`; rewrite the `inlineStyles` inner loop to iterate the computed declaration.
- **Modify** `apps/plugin/bookmarklet/snapshot.test.ts` — iterable DI stub; assert layout-critical props inlined, blacklist props dropped.
- **Modify** `apps/plugin/bookmarklet/snapshot-whitelist.test.ts` — import `SNAPSHOT_SKIP_PROPS`; flip to intersection-empty + sanity asserts.
- **Regenerate** `apps/plugin/bookmarklet/snapshot.bookmarklet.txt` and `apps/plugin/extension/content.js`.
- **Modify** `apps/plugin/bookmarklet/README.md` + `apps/plugin/extension/README.md` — size note.

Order: blacklist + loop + inline tests (Task 1) → guard-test flip (Task 2) → regenerate bundles (Task 3) → READMEs (Task 4).

---

## Task 1: Inline all computed styles minus a blacklist

**Files:**
- Modify: `apps/plugin/bookmarklet/snapshot.js`
- Test: `apps/plugin/bookmarklet/snapshot.test.ts`

- [ ] **Step 1: Rewrite the inline test with an iterable stub**

Replace the top of `apps/plugin/bookmarklet/snapshot.test.ts` (the `fakeGetStyle`
/ `getStyle` helpers and the first two `it` blocks) so the stub exposes an
iterable declaration (`length` + numeric indices + `getPropertyValue`). Replace
lines 5–34 with:

```ts
// Inject a deterministic, iterable getStyle (length + indices + getPropertyValue),
// matching the shape of a real CSSStyleDeclaration, so the test exercises the
// computed-declaration loop without relying on happy-dom's computed styles.
function makeStyle(map: Record<string, string>) {
  const keys = Object.keys(map);
  const decl: Record<string, unknown> = {
    length: keys.length,
    getPropertyValue: (p: string) => map[p] ?? "",
  };
  keys.forEach((k, i) => {
    decl[i] = k;
  });
  return decl as unknown as CSSStyleDeclaration;
}

function getStyle(_el: Element): CSSStyleDeclaration {
  return makeStyle({
    color: "rgb(1, 2, 3)",
    width: "100px",
    "flex-direction": "column",
    gap: "20px",
    "justify-content": "center",
    "grid-template-columns": "1fr 1fr",
    transform: "translateX(5px)",
    cursor: "pointer", // blacklisted — must be dropped
    content: '"x"', // blacklisted — must be dropped
    "animation-name": "spin", // blacklisted — must be dropped
    "transition-duration": "1s", // blacklisted — must be dropped
  });
}

describe("buildSnapshotHtml", () => {
  it("inlines layout-critical properties onto elements", () => {
    document.body.innerHTML = "<div id='x'>hi</div>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html).toContain("width: 100px");
    expect(html).toContain("flex-direction: column");
    expect(html).toContain("gap: 20px");
    expect(html).toContain("justify-content: center");
    expect(html).toContain("grid-template-columns: 1fr 1fr");
    expect(html).toContain("transform: translateX(5px)");
  });

  it("does not inline blacklisted properties", () => {
    document.body.innerHTML = "<div>hi</div>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html).not.toContain("cursor");
    expect(html).not.toContain("content:");
    expect(html).not.toContain("animation-name");
    expect(html).not.toContain("transition-duration");
  });
```

(The remaining three tests — "strips <script> and <noscript>", "produces a full
HTML document", "does not throw on a shadow host" — are unchanged; they call the
new `getStyle` but only assert on structure.)

- [ ] **Step 2: Run the inline test to verify it fails**

Run: `pnpm --filter plugin exec vitest run snapshot.test.ts`
Expected: FAIL — `inlineStyles` still loops the old `SNAPSHOT_STYLE_PROPS`
whitelist, so `width`/`gap`/etc. are not inlined, and the old stub fields
(`padding-top`) are gone.

- [ ] **Step 3: Replace the whitelist with the blacklist and rewrite the loop**

In `apps/plugin/bookmarklet/snapshot.js`, replace the `SNAPSHOT_STYLE_PROPS`
constant (the whole exported array) with the blacklist:

```js
// CSS properties NOT inlined into the snapshot. Everything else getComputedStyle
// reports is inlined so the re-rendered snapshot lays out identically. These are
// excluded because they break re-rendering or are pure noise. getComputedStyle
// enumerates longhands (not shorthands), so the animation/transition longhands
// are listed individually.
export const SNAPSHOT_SKIP_PROPS = new Set([
  "content",
  "cursor",
  "will-change",
  "contain",
  "content-visibility",
  "inline-size",
  "block-size",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-direction",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-play-state",
  "animation-timeline",
  "animation-timing-function",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
]);
```

Then rewrite the body of `inlineStyles` (keep its
`(original, clone, getStyle)` signature and the lockstep child recursion):

```js
function inlineStyles(original, clone, getStyle) {
  const computed = getStyle(original);
  const decls = [];
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed[i];
    if (SNAPSHOT_SKIP_PROPS.has(prop)) {
      continue;
    }
    const value = computed.getPropertyValue(prop);
    if (value) {
      decls.push(`${prop}: ${value}`);
    }
  }
  if (decls.length > 0) {
    clone.setAttribute("style", decls.join("; "));
  }
  const originalChildren = original.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < originalChildren.length; i += 1) {
    inlineStyles(originalChildren[i], cloneChildren[i], getStyle);
  }
}
```

- [ ] **Step 4: Run the inline test to verify it passes**

Run: `pnpm --filter plugin exec vitest run snapshot.test.ts`
Expected: PASS (all five tests).

- [ ] **Step 5: Format + commit**

```bash
pnpm exec biome check --write apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot.test.ts
git add apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot.test.ts
git commit -m "feat(plugin): inline all computed styles (minus a blacklist) in snapshot"
```

---

## Task 2: Flip the guard test to the blacklist invariant

**Files:**
- Modify: `apps/plugin/bookmarklet/snapshot-whitelist.test.ts`

- [ ] **Step 1: Update the import and assertions**

In `apps/plugin/bookmarklet/snapshot-whitelist.test.ts`, change the import (line
4) from `SNAPSHOT_STYLE_PROPS` to `SNAPSHOT_SKIP_PROPS`:

```ts
import { SNAPSHOT_SKIP_PROPS } from "./snapshot.js";
```

Add a clarifying comment above the `describe` and replace the `describe` block
(the old subset check) with the intersection-empty + sanity checks:

```ts
// Guards the snapshot blacklist (SNAPSHOT_SKIP_PROPS), not a whitelist: the
// snapshot now inlines everything except the blacklist, so the converter's read
// properties must never be blacklisted, and layout-critical props must stay out
// of the blacklist.
describe("snapshot blacklist", () => {
  it("never blacklists a property the converter reads", () => {
    const blacklisted = [...converterReadProps()].filter((p) =>
      SNAPSHOT_SKIP_PROPS.has(p)
    );
    expect(blacklisted).toEqual([]);
  });

  it("keeps layout-critical properties out of the blacklist", () => {
    expect(SNAPSHOT_SKIP_PROPS.has("display")).toBe(false);
    expect(SNAPSHOT_SKIP_PROPS.has("width")).toBe(false);
    expect(SNAPSHOT_SKIP_PROPS.has("flex-direction")).toBe(false);
  });
});
```

(The `converterReadProps()` / `walk()` / `camelToKebab()` helpers above are
unchanged.)

- [ ] **Step 2: Run the guard test to verify it passes**

Run: `pnpm --filter plugin exec vitest run snapshot-whitelist.test.ts`
Expected: PASS (2 tests) — no converter-read prop is blacklisted, and the layout
props are not in the blacklist.

- [ ] **Step 3: Run the full plugin suite + typecheck**

Run: `pnpm --filter plugin check-types && pnpm --filter plugin exec vitest run`
Expected: PASS — the extension build smoke test still finds the snapshot marker
(`woofigma-snapshot.html`), and all snapshot tests pass.

- [ ] **Step 4: Format + commit**

```bash
pnpm exec biome check --write apps/plugin/bookmarklet/snapshot-whitelist.test.ts
git add apps/plugin/bookmarklet/snapshot-whitelist.test.ts
git commit -m "test(plugin): guard the snapshot blacklist against converter reads"
```

---

## Task 3: Regenerate the bookmarklet and extension bundles

**Files:**
- Regenerate: `apps/plugin/bookmarklet/snapshot.bookmarklet.txt`
- Regenerate: `apps/plugin/extension/content.js`

- [ ] **Step 1: Regenerate both bundles**

Run:
```bash
node apps/plugin/bookmarklet/build.mjs
node apps/plugin/extension/build-extension.mjs
```
Expected: `Wrote snapshot.bookmarklet.txt (<N> chars)` and the extension build
writes `content.js`.

- [ ] **Step 2: Sanity-check the regenerated bundles**

Run:
```bash
node -e "const s=require('fs').readFileSync('apps/plugin/bookmarklet/snapshot.bookmarklet.txt','utf8'); if(!s.startsWith('javascript:'))throw new Error('bad'); if(!decodeURIComponent(s.slice(11)).includes('SNAPSHOT_SKIP_PROPS') && !decodeURIComponent(s.slice(11)).includes('woofigma-snapshot.html'))throw new Error('missing marker'); console.log('bookmarklet ok')"
grep -q "woofigma-snapshot.html" apps/plugin/extension/content.js && echo "content.js ok"
```
Expected: `bookmarklet ok` and `content.js ok`.

- [ ] **Step 3: Run the extension smoke test (confirms content.js rebuilt cleanly)**

Run: `pnpm --filter plugin exec vitest run extension-build.test.ts`
Expected: PASS (it rebuilds `content.js` in `beforeAll` and checks the marker).

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/bookmarklet/snapshot.bookmarklet.txt apps/plugin/extension/content.js
git commit -m "build(plugin): regenerate snapshot bundles for the new inliner"
```

---

## Task 4: Update the READMEs with the size note

**Files:**
- Modify: `apps/plugin/bookmarklet/README.md`
- Modify: `apps/plugin/extension/README.md`

- [ ] **Step 1: Add the size note to the bookmarklet README**

In `apps/plugin/bookmarklet/README.md`, find the "What it captures" section. After
its first paragraph (the one describing what's inlined), add:

```markdown
Snapshots now inline nearly all computed styles (minus a small blacklist), which
guarantees an identical layout when the converter re-renders them — but makes the
HTML much larger (roughly 5–10× the previous size; several MB on heavy pages).
That's expected for a one-shot capture.
```

- [ ] **Step 2: Add the same note to the extension README**

In `apps/plugin/extension/README.md`, find the "What it captures / limits"
section and add the same paragraph after its first paragraph:

```markdown
Snapshots now inline nearly all computed styles (minus a small blacklist), which
guarantees an identical layout when the converter re-renders them — but makes the
HTML much larger (roughly 5–10× the previous size; several MB on heavy pages).
That's expected for a one-shot capture.
```

- [ ] **Step 3: Commit**

```bash
git add apps/plugin/bookmarklet/README.md apps/plugin/extension/README.md
git commit -m "docs: note the snapshot now inlines all styles (larger files)"
```

---

## Self-Review

- **Spec coverage:** blacklist replaces whitelist with full animation/transition
  longhands (Task 1 Step 3) ✓; iterate computed declaration (Task 1 Step 3) ✓;
  lockstep `(original, clone, getStyle)` kept, clone-target preserved (Task 1
  Step 3) ✓; layout-critical props inlined / blacklist dropped (Task 1 tests) ✓;
  guard flipped to intersection-empty + sanity (Task 2) ✓; bundles regenerated
  (Task 3) ✓; READMEs size note (Task 4) ✓; plugin/converter unchanged (no task
  touches them) ✓.
- **Placeholders:** none — full code shown.
- **Type/name consistency:** `SNAPSHOT_SKIP_PROPS` (a `Set`) is defined in Task 1
  and imported in Task 2; the `.has(prop)` usage matches in both. The iterable
  stub's shape (`length` + numeric indices + `getPropertyValue`) matches the loop
  `computed[i]` / `computed.getPropertyValue(prop)`. `buildSnapshotHtml`,
  `runSnapshot`, `inlineStyles` signatures are unchanged.
- **Stub note:** the three unchanged tests pass `getStyle` but assert only on
  document structure (script strip / doctype / shadow), so the new iterable stub
  (a superset of the old) keeps them green.
- **Typecheck scope:** `snapshot.js` is still outside tsc `include`; the
  `.test.ts` files run under vitest. No tsc change needed.