# System / generic font-name pre-mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve known generic/system CSS font names (`sans-serif`, `serif`, `monospace`, `system-ui`, `-apple-system`, `ui-monospace`, …) to real fontsource families before any CDN fetch, eliminating the 404 noise from doomed jsDelivr requests — without changing the substitution semantics (the Figma payload keeps the requested family name).

**Architecture:** Add a static `GENERIC_FAMILY_MAP` (keyed by `familyToSlug` output) and a short-circuit branch inside the loader returned by `createFontsourceLoader`, consulted before `fetchFromFontsource` and before the `knownMissingFamilies` cache. Generic names delegate to the existing `loadAsFallback`, which already sets `resolvedFamily`. Sans-category generics depend on the configured `fallbackFamily`; `serif`/`monospace` map to fixed families. Strict mode (`fallbackFamily: null`) throws an explicit error for sans-generics.

**Tech Stack:** TypeScript, Vitest (node `unit` project + `browser` project via Playwright), fontkit. Single source file: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts`.

---

## File Structure

- **Modify:** `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts`
  - Add `GENERIC_FAMILY_MAP` constant + a `resolveGenericFamily` helper.
  - Add a short-circuit branch at the top of the returned loader.
- **Create:** `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts`
  - Node unit test (`*.test.ts` → `unit` project). Mocks global `fetch`, asserts requested URLs and `resolvedFamily`. No real font parsing.
- **Modify (docs, final task):** `apps/plugin/README.md`, root `README.md` — update the "system fonts 404" limitation note.

Note: the existing `loadFont`-level postScriptName synthesis (payload keeps requested family) is already correct code and is exercised by the substitution path; the new unit test asserts the loader contract (`resolvedFamily` set, zero fetches to the generic name). We do not add a browser test — mocking `fetch` in node fully covers the new behavior, and `loadFont` synthesis is unchanged.

---

## Task 1: Generic-family map + resolution helper (no wiring yet)

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts`
- Test: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFontsourceLoader } from "./loader";

// Minimal valid-looking bytes; the loader only forwards bytes, it does not
// parse them (parsing happens later in loadFont, which these tests don't call).
const FAKE_FONT_BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

function mockFetch() {
  const urls: string[] = [];
  const spy = vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(FAKE_FONT_BYTES, { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFontsourceLoader generic-family mapping", () => {
  it("maps monospace to roboto-mono with one fetch and no monospace URL", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader();

    const file = await load({ family: "monospace", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("Roboto Mono");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/roboto-mono@");
    expect(urls.some((u) => u.includes("/monospace@"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project unit loader.test.ts`
Expected: FAIL — `resolvedFamily` is `undefined` (loader currently fetches `/monospace@…`, 404s in the real impl, but with the mock returning 200 it "succeeds" on the monospace URL so `resolvedFamily` is unset and the URL assertion fails).

- [ ] **Step 3: Add the map + helper (still unused)**

In `loader.ts`, just below the existing `DEFAULT_FALLBACK_FAMILY` constant (≈ line 162), add:

```ts
/**
 * Generic / system CSS family names → a real fontsource family to substitute.
 *
 * Keys are the output of `familyToSlug` (lowercased, quotes stripped, spaces →
 * hyphens). `familyToSlug` does NOT strip a leading hyphen, so `-apple-system`
 * keeps it and `BlinkMacSystemFont` becomes `blinkmacsystemfont`. Do not
 * "normalize" the leading hyphen away.
 *
 * The empty-string value is a sentinel meaning "use the configured
 * fallbackFamily" (sans-category generics). `serif`/`monospace` map to fixed
 * families that do not depend on fallbackFamily.
 */
const SANS_FALLBACK = "" as const;
const GENERIC_FAMILY_MAP: Record<string, string> = {
  "sans-serif": SANS_FALLBACK,
  "ui-sans-serif": SANS_FALLBACK,
  "ui-rounded": SANS_FALLBACK,
  "system-ui": SANS_FALLBACK,
  "-apple-system": SANS_FALLBACK,
  blinkmacsystemfont: SANS_FALLBACK,
  cursive: SANS_FALLBACK,
  fantasy: SANS_FALLBACK,
  math: SANS_FALLBACK,
  emoji: SANS_FALLBACK,
  serif: "PT Serif",
  "ui-serif": "PT Serif",
  monospace: "Roboto Mono",
  "ui-monospace": "Roboto Mono",
};
```

- [ ] **Step 4: Run lint/typecheck to confirm it compiles**

Run: `pnpm --filter @woofigma/dom-to-figma check-types`
Expected: PASS (the constant is unused but valid; Knip is not run here).

The test still fails (helper not wired) — that's expected; wiring is Task 2.

- [ ] **Step 5: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts \
        packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts
git commit -m "test(dom-to-figma): add generic-family map + failing loader test"
```

---

## Task 2: Wire the short-circuit into the loader

**Files:**
- Modify: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts:190-223` (the returned loader function inside `createFontsourceLoader`)
- Test: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts`

- [ ] **Step 1: Add the short-circuit branch**

Inside `createFontsourceLoader`, in the returned `async (request) => { … }`, insert the generic check as the **first** thing in the function body, before the `knownMissingFamilies` check:

```ts
  return async (request: FontProperties): Promise<FontFile> => {
    const familyKey = familyToSlug(request.family);

    const mappedGeneric = GENERIC_FAMILY_MAP[familyKey];
    if (mappedGeneric !== undefined) {
      // Sans-category sentinel → use the configured fallback (may be null).
      const target = mappedGeneric === SANS_FALLBACK ? fallbackFamily : mappedGeneric;
      if (!target) {
        throw new Error(
          `fontsource: "${request.family}" requires a fallbackFamily (none configured)`
        );
      }
      return await loadAsFallback(target, request, subset);
    }

    const isFallbackRequest = fallbackKey === familyKey;
    // … existing body continues unchanged …
```

Note: the existing body already computes `const familyKey = familyToSlug(request.family);` and `const isFallbackRequest = …` at the top — replace those two lines with the block above so `familyKey` is not declared twice.

- [ ] **Step 2: Run the Task-1 test to verify it now passes**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project unit loader.test.ts`
Expected: PASS — one fetch to `/roboto-mono@…`, `resolvedFamily === "Roboto Mono"`.

- [ ] **Step 3: Run the full package suite + typecheck (no regression)**

Run: `pnpm --filter @woofigma/dom-to-figma check-types && pnpm --filter @woofigma/dom-to-figma exec vitest run --project unit`
Expected: PASS. (Browser project unchanged; run it too if convenient: `pnpm --filter @woofigma/dom-to-figma test`.)

- [ ] **Step 4: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.ts
git commit -m "feat(dom-to-figma): pre-map generic font names before CDN fetch"
```

---

## Task 3: Cover sans-fallback, serif, strict mode, and the slug-key guard

**Files:**
- Test: `packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts`

- [ ] **Step 1: Add the remaining test cases**

Append these `it` blocks inside the existing `describe`:

```ts
  it("maps sans-serif through the configured fallbackFamily (default Inter)", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader();

    const file = await load({ family: "sans-serif", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("Inter");
    expect(urls[0]).toContain("/inter@");
    expect(urls.some((u) => u.includes("/sans-serif@"))).toBe(false);
  });

  it("honors a custom fallbackFamily for sans generics", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader({ fallbackFamily: "Roboto" });

    const file = await load({ family: "system-ui", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("Roboto");
    expect(urls[0]).toContain("/roboto@");
  });

  it("maps serif to pt-serif regardless of fallbackFamily", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader({ fallbackFamily: null });

    const file = await load({ family: "serif", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("PT Serif");
    expect(urls[0]).toContain("/pt-serif@");
  });

  it("throws an explicit error for sans generics when fallbackFamily is null", async () => {
    mockFetch();
    const load = createFontsourceLoader({ fallbackFamily: null });

    await expect(
      load({ family: "sans-serif", weight: 400, italic: false })
    ).rejects.toThrow(/requires a fallbackFamily/);
  });

  it("treats -apple-system (leading hyphen) as a sans generic", async () => {
    const { urls } = mockFetch();
    const load = createFontsourceLoader();

    const file = await load({ family: "-apple-system", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("Inter");
    expect(urls.some((u) => u.includes("apple-system@"))).toBe(false);
  });

  it("does not treat a real missing family as generic (no regression)", async () => {
    // Verdana is not generic: it goes through the normal fetch + fallback path.
    // Mock returns 404 for the verdana URLs, 200 for the inter fallback.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const status = url.includes("/verdana@") ? 404 : 200;
        return new Response(status === 200 ? FAKE_FONT_BYTES : null, { status });
      })
    );
    const load = createFontsourceLoader();

    const file = await load({ family: "Verdana", weight: 400, italic: false });

    expect(file.resolvedFamily).toBe("Inter");
    expect(urls.some((u) => u.includes("/verdana@"))).toBe(true);
  });
```

- [ ] **Step 2: Run the test file**

Run: `pnpm --filter @woofigma/dom-to-figma exec vitest run --project unit loader.test.ts`
Expected: PASS — all 7 cases green.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter @woofigma/dom-to-figma lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add packages/dom-to-figma/src/converter/nodes/text/primitives/font/loader.test.ts
git commit -m "test(dom-to-figma): cover sans/serif/strict/slug-key font mapping"
```

---

## Task 4: Update the known-limitation notes in the READMEs

**Files:**
- Modify: `apps/plugin/README.md:57-59` (the "System fonts 404 on the CDN" bullet)
- Modify: root `README.md` (the limitation #1 bullet)

- [ ] **Step 1: Edit the plugin README bullet**

In `apps/plugin/README.md`, replace the "System fonts 404 on the CDN" bullet with:

```markdown
- **System fonts resolve to fallbacks.** Generic / system family names
  (`ui-monospace`, `-apple-system`, `system-ui`, `sans-serif`, `serif`,
  `monospace`, …) are mapped to a fontsource family before any CDN request, so
  there's no 404 noise: serif → PT Serif, monospace → Roboto Mono, everything
  else → the configured fallback (Inter by default). The Figma payload still
  claims the original family name, so Figma renders the real system font if it's
  installed at the destination.
```

- [ ] **Step 2: Edit the root README limitation**

In root `README.md`, replace limitation item 1 ("System-font 404 noise") with a one-line note that it's resolved, and renumber the remaining two items (raster images, bundled pages) to 1 and 2.

```markdown
Open edges, roughly by increasing effort:

1. **Raster image fills in the plugin** — wire `figma.createImage` so bitmap
   fills land as real images on the canvas.
2. **Bundled / self-unpacking pages vs. CSP** — pages that load React (or
   similar) from a CDN at runtime hit the plugin's `script-src` CSP. Resolving
   it means widening the manifest `allowedDomains` to the needed CDNs, or
   unpacking bundles outside the plugin CSP.

System / generic font names (`ui-monospace`, `-apple-system`, `sans-serif`,
`serif`, `monospace`, …) are mapped to fontsource families before any CDN
request, so they no longer 404.
```

- [ ] **Step 3: Verify no stale "404 noise" phrasing remains**

Run: `grep -rn "404" README.md apps/plugin/README.md`
Expected: no remaining bullet claiming the noise is unresolved.

- [ ] **Step 4: Commit**

```bash
git add README.md apps/plugin/README.md
git commit -m "docs: note system-font 404 noise is resolved"
```

---

## Self-Review

- **Spec coverage:** map (Task 1) ✓; short-circuit before cache/fetch + strict-mode guard (Task 2) ✓; sans/serif/mono behavior, `resolvedFamily`, zero generic fetches, slug-key `-apple-system`, no-regression (Task 3) ✓; README follow-up (Task 4) ✓. Spec test #4's `loadFont`-postScriptName half is intentionally NOT re-tested — it is unchanged existing code; the loader contract (`resolvedFamily` set) is the new behavior and is covered.
- **Placeholders:** none — all test and impl code is concrete.
- **Type consistency:** `GENERIC_FAMILY_MAP`, `SANS_FALLBACK`, `loadAsFallback(target, request, subset)`, `familyToSlug`, `FontProperties`, `FontFile.resolvedFamily` all match the names in `loader.ts`. The Task-2 note about not double-declaring `familyKey`/`isFallbackRequest` prevents a compile error.
- **Slug-key correctness:** keys verified against `familyToSlug` (leading hyphen preserved) in the spec; Task 3 test #5 guards it.
