# Snapshot bookmarklet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bookmarklet that captures a page's live post-JS DOM (in the user's own session), inlines the converter-read CSS properties, strips scripts, and downloads/copies a self-contained `.html` to drop into the plugin.

**Architecture:** A testable `snapshot.js` module exports `SNAPSHOT_STYLE_PROPS` (the whitelist) and `buildSnapshotHtml(documentElement, getStyle)` (pure-ish: DOM in, HTML string out, with `getComputedStyle` injected for testability), plus a self-invoking bookmarklet wrapper. A node guard test diffs the converter's read CSS props against the whitelist; a happy-dom test covers the inlining/strip logic. The plugin app/converter are unchanged — snapshots enter via the existing file-drop/paste flow.

**Tech Stack:** TypeScript/JS, Vitest. The whitelist guard test is pure node + fs. The inlining test uses `happy-dom` (added to the plugin) via a per-file `// @vitest-environment happy-dom` docblock and dependency-injected `getStyle`.

---

## File Structure

- **Create** `apps/plugin/bookmarklet/snapshot.js` — `SNAPSHOT_STYLE_PROPS` + `buildSnapshotHtml(root, getStyle)` + `runSnapshot()` (the bookmarklet entry: walks `document`, builds HTML, downloads + clipboard + toast).
- **Create** `apps/plugin/bookmarklet/snapshot.test.ts` — inlining/strip tests (happy-dom + injected getStyle).
- **Create** `apps/plugin/bookmarklet/snapshot-whitelist.test.ts` — guard test (node + fs), diffs converter props ⊆ whitelist.
- **Create** `apps/plugin/bookmarklet/snapshot.bookmarklet.txt` — the minified `javascript:` one-liner.
- **Create** `apps/plugin/bookmarklet/README.md` — install/use/regenerate instructions + limitations.
- **Modify** `apps/plugin/package.json` — add `happy-dom` devDep.
- **Modify** `apps/plugin/vitest.config.ts` — include `bookmarklet/**/*.test.ts` in the test glob.

Order: whitelist constant + guard test (Task 1, pure node, the maintenance gate) → inlining logic + happy-dom test (Task 2) → bookmarklet entry + minified string (Task 3) → README (Task 4).

---

## Task 1: `SNAPSHOT_STYLE_PROPS` + whitelist guard test

**Files:**
- Create: `apps/plugin/bookmarklet/snapshot.js`
- Create: `apps/plugin/bookmarklet/snapshot-whitelist.test.ts`
- Modify: `apps/plugin/vitest.config.ts`

- [ ] **Step 1: Extend the vitest glob to include the bookmarklet folder**

Replace `apps/plugin/vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "bookmarklet/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Write the failing guard test**

Create `apps/plugin/bookmarklet/snapshot-whitelist.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_STYLE_PROPS } from "./snapshot.js";

const CONVERTER_ROOT = join(
  __dirname,
  "../../../packages/dom-to-figma/src/converter"
);

function walk(dir: string): Array<string> {
  let out: Array<string> = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out = out.concat(walk(p));
    } else if (p.endsWith(".ts") && !p.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function converterReadProps(): Set<string> {
  const props = new Set<string>();
  for (const file of walk(CONVERTER_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/computedStyle\.([a-zA-Z]+)/g)) {
      props.add(camelToKebab(m[1] as string));
    }
    for (const m of src.matchAll(
      /getPropertyValue\(\s*["'`]([a-z-]+)["'`]/g
    )) {
      props.add(m[1] as string);
    }
  }
  props.delete("get-property-value");
  return props;
}

describe("snapshot whitelist", () => {
  it("covers every CSS property the converter reads", () => {
    const whitelist = new Set(SNAPSHOT_STYLE_PROPS);
    const missing = [...converterReadProps()].filter(
      (p) => !whitelist.has(p)
    );
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter plugin exec vitest run snapshot-whitelist.test.ts`
Expected: FAIL — `./snapshot.js` has no export `SNAPSHOT_STYLE_PROPS`.

- [ ] **Step 4: Create `snapshot.js` with the whitelist constant**

Create `apps/plugin/bookmarklet/snapshot.js`:

```js
// Snapshot bookmarklet source. Captures a page's live (post-JS) DOM, inlines the
// CSS properties the converter reads, strips scripts, and downloads/copies a
// self-contained .html for the Woofigma plugin.
//
// SNAPSHOT_STYLE_PROPS must stay in sync with the properties the converter reads
// in packages/dom-to-figma/src/converter. A guard test
// (snapshot-whitelist.test.ts) fails the build if the converter starts reading a
// property missing here.
export const SNAPSHOT_STYLE_PROPS = [
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "white-space",
  "background",
  "background-color",
  "background-image",
  "background-clip",
  "opacity",
  "display",
  "position",
  "overflow",
  "overflow-x",
  "overflow-y",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "clip",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-width",
  "border-color",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "clip-rule",
];
```

- [ ] **Step 5: Run the guard test to verify it passes**

Run: `pnpm --filter plugin exec vitest run snapshot-whitelist.test.ts`
Expected: PASS — the whitelist is a superset of the converter's read props.

- [ ] **Step 6: Format + commit**

```bash
pnpm exec biome check --write apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot-whitelist.test.ts
git add apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot-whitelist.test.ts apps/plugin/vitest.config.ts
git commit -m "feat(plugin): snapshot whitelist + converter-sync guard test"
```

---

## Task 2: `buildSnapshotHtml` — inline + strip + serialize

**Files:**
- Modify: `apps/plugin/bookmarklet/snapshot.js`
- Create: `apps/plugin/bookmarklet/snapshot.test.ts`
- Modify: `apps/plugin/package.json`

- [ ] **Step 1: Add happy-dom to the plugin devDeps and install**

In `apps/plugin/package.json`, add to `devDependencies` (alphabetical):

```json
    "happy-dom": "^20.9.0",
```

Run: `pnpm install`
Expected: happy-dom linked into the plugin.

- [ ] **Step 2: Write the failing inlining test**

Create `apps/plugin/bookmarklet/snapshot.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildSnapshotHtml } from "./snapshot.js";

// Inject a deterministic getStyle so the test doesn't rely on happy-dom's
// (incomplete) computed styles. Returns a fixed map for every element.
function fakeGetStyle(): Record<string, string> {
  return {
    color: "rgb(1, 2, 3)",
    "padding-top": "10px",
    cursor: "pointer", // not in the whitelist — must be dropped
    "z-index": "5", // not in the whitelist — must be dropped
  };
}

function getStyle(_el: Element) {
  const map = fakeGetStyle();
  return { getPropertyValue: (p: string) => map[p] ?? "" };
}

describe("buildSnapshotHtml", () => {
  it("inlines whitelisted properties onto elements", () => {
    document.body.innerHTML = "<div id='x'>hi</div>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html).toContain("color: rgb(1, 2, 3)");
    expect(html).toContain("padding-top: 10px");
  });

  it("does not inline non-whitelisted properties", () => {
    document.body.innerHTML = "<div>hi</div>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html).not.toContain("cursor");
    expect(html).not.toContain("z-index");
  });

  it("strips <script> and <noscript>", () => {
    document.body.innerHTML =
      "<div>hi</div><script>alert(1)</script><noscript>x</noscript>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<noscript");
  });

  it("produces a full HTML document", () => {
    document.body.innerHTML = "<div>hi</div>";
    const html = buildSnapshotHtml(document.documentElement, getStyle);
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain("<html");
  });

  it("does not throw on a shadow host", () => {
    document.body.innerHTML = "<div id='host'></div>";
    const host = document.getElementById("host");
    host?.attachShadow({ mode: "open" });
    expect(() =>
      buildSnapshotHtml(document.documentElement, getStyle)
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter plugin exec vitest run snapshot.test.ts`
Expected: FAIL — `buildSnapshotHtml` is not exported.

- [ ] **Step 4: Implement `buildSnapshotHtml` and the walk in `snapshot.js`**

Append to `apps/plugin/bookmarklet/snapshot.js`:

```js
// Recursively copy whitelisted computed styles from `original` onto `clone`,
// walking element children in lockstep. `getStyle(el)` returns an object with a
// `getPropertyValue(prop)` method (real getComputedStyle in the bookmarklet, a
// stub in tests). Shadow roots are not traversed; nothing here throws on a
// shadow host because we only read light-DOM `children`.
function inlineStyles(original, clone, getStyle) {
  const computed = getStyle(original);
  const decls = [];
  for (const prop of SNAPSHOT_STYLE_PROPS) {
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

// Build a self-contained HTML document string from a live document element.
// `getStyle` defaults to window.getComputedStyle in the browser.
export function buildSnapshotHtml(
  documentElement,
  getStyle = (el) => globalThis.getComputedStyle(el)
) {
  const clone = documentElement.cloneNode(true);
  inlineStyles(documentElement, clone, getStyle);
  for (const el of clone.querySelectorAll("script, noscript")) {
    el.remove();
  }
  return `<!doctype html>\n${clone.outerHTML}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter plugin exec vitest run snapshot.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the whole plugin suite + format + commit**

```bash
pnpm --filter plugin exec vitest run
pnpm exec biome check --write apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot.test.ts
git add apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot.test.ts apps/plugin/package.json pnpm-lock.yaml
git commit -m "feat(plugin): buildSnapshotHtml inlines whitelisted styles, strips scripts"
```

---

## Task 3: bookmarklet entry (`runSnapshot`) + minified string

**Files:**
- Modify: `apps/plugin/bookmarklet/snapshot.js`
- Create: `apps/plugin/bookmarklet/snapshot.bookmarklet.txt`

- [ ] **Step 1: Add the `runSnapshot` entry point**

Append to `apps/plugin/bookmarklet/snapshot.js`:

```js
// Bookmarklet entry: build the snapshot from the current page, download it, copy
// to clipboard (best-effort), and toast the user. Not unit-tested (browser-only
// side effects); the testable logic lives in buildSnapshotHtml above.
export function runSnapshot() {
  const toast = (msg) => {
    let el = document.getElementById("__woofigma_toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "__woofigma_toast";
      el.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0d99ff;color:#fff;font:13px/1.4 sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
      document.body.appendChild(el);
    }
    el.textContent = msg;
  };

  const count = document.documentElement.querySelectorAll("*").length;
  toast(`Processing ${count} elements…`);

  const html = buildSnapshotHtml(document.documentElement);

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "woofigma-snapshot.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(html).catch(() => {
      // clipboard blocked (no permission/gesture) — the download already fired.
    });
  }

  toast("Snapshot saved — drop the .html into Woofigma (or paste).");
}
```

- [ ] **Step 2: Generate the minified `javascript:` bookmarklet string**

Run this command (uses esbuild via npx to bundle+minify the IIFE; it inlines the
module so the bookmarklet is self-contained):

```bash
npx --yes esbuild apps/plugin/bookmarklet/snapshot.js \
  --bundle --minify --format=iife --global-name=__woofigma \
  --footer:js='__woofigma.runSnapshot();' 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const enc=encodeURIComponent(s);require("fs").writeFileSync("apps/plugin/bookmarklet/snapshot.bookmarklet.txt","javascript:"+enc+"\n")})'
```

Expected: writes `apps/plugin/bookmarklet/snapshot.bookmarklet.txt` containing a
single `javascript:...` line.

- [ ] **Step 3: Sanity-check the generated string**

Run: `node -e "const s=require('fs').readFileSync('apps/plugin/bookmarklet/snapshot.bookmarklet.txt','utf8'); if(!s.startsWith('javascript:')) throw new Error('bad prefix'); if(s.length<500) throw new Error('too short'); console.log('bookmarklet ok,', s.length, 'chars')"`
Expected: `bookmarklet ok, <N> chars` (well under the ~64 KB browser limit).

- [ ] **Step 4: Commit**

```bash
pnpm exec biome check --write apps/plugin/bookmarklet/snapshot.js
git add apps/plugin/bookmarklet/snapshot.js apps/plugin/bookmarklet/snapshot.bookmarklet.txt
git commit -m "feat(plugin): bookmarklet entry point and minified javascript: string"
```

---

## Task 4: bookmarklet README

**Files:**
- Create: `apps/plugin/bookmarklet/README.md`

- [ ] **Step 1: Write the local README**

Create `apps/plugin/bookmarklet/README.md`:

```markdown
# Woofigma snapshot bookmarklet

Captures a page's **live, rendered** DOM (after its JavaScript has run, in your
own logged-in session) into a self-contained `.html` you can drop into the
Woofigma plugin. Use it for pages that Load-from-URL can't reach: private /
authenticated dashboards and JS-rendered SPAs.

## Install

1. Open `snapshot.bookmarklet.txt` and copy the whole `javascript:…` line.
2. Create a new bookmark in your browser (e.g. right-click the bookmarks bar →
   Add page / New bookmark).
3. Name it "Woofigma snapshot" and paste the copied string as the **URL**.

## Use

1. Navigate to the page you want to import.
2. Click the **Woofigma snapshot** bookmark.
3. A toast shows progress; a `woofigma-snapshot.html` downloads (and the HTML is
   copied to your clipboard if the browser allows).
4. In Figma, run the plugin and drop the `.html` onto the drop zone (or paste).

## What it captures

The live DOM with the CSS properties the converter reads inlined onto each
element, with `<script>`/`<noscript>` removed.

**Not captured:** Shadow DOM, `<canvas>`/WebGL, `<video>`, cross-origin
`<iframe>`, and `::before`/`::after` pseudo-elements (the converter doesn't
render those). Very large pages (>~2000 elements) take ~1–3 s and produce a
multi-MB file — that's expected for a one-shot capture.

## Regenerating the minified string

`snapshot.bookmarklet.txt` is generated from `snapshot.js`:

\`\`\`bash
npx --yes esbuild apps/plugin/bookmarklet/snapshot.js \
  --bundle --minify --format=iife --global-name=__woofigma \
  --footer:js='__woofigma.runSnapshot();' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("fs").writeFileSync("apps/plugin/bookmarklet/snapshot.bookmarklet.txt","javascript:"+encodeURIComponent(s)+"\n")})'
\`\`\`

The whitelist of inlined properties (`SNAPSHOT_STYLE_PROPS` in `snapshot.js`) is
kept in sync with the converter by `snapshot-whitelist.test.ts`, which fails the
build if the converter starts reading a property the bookmarklet would drop.
```

- [ ] **Step 2: Commit**

```bash
git add apps/plugin/bookmarklet/README.md
git commit -m "docs: snapshot bookmarklet install/use instructions"
```

---

## Self-Review

- **Spec coverage:** clone + lockstep walk + whitelist inline (Task 2
  `inlineStyles`) ✓; strip script/noscript (Task 2) ✓; doctype + outerHTML
  serialize (Task 2) ✓; download + clipboard + toast (Task 3 `runSnapshot`) ✓;
  whitelist as named const with sync comment (Task 1) ✓; **guard test** enforcing
  converter⊆whitelist (Task 1) ✓; shadow host doesn't throw (Task 2 test) ✓;
  non-whitelisted prop dropped (Task 2 test) ✓; ready `.txt` string (Task 3) ✓;
  local README with install/limitations/regen (Task 4) ✓; plugin/converter
  unchanged ✓.
- **Specificity note:** `inlineStyles` writes only the whitelisted computed
  values; it does not re-append the original inline `style`, because the computed
  value already reflects inline (per the spec's corrected specificity section).
- **Placeholders:** none — all code concrete.
- **Type consistency:** `SNAPSHOT_STYLE_PROPS` (array of kebab strings) used in
  Task 1 (def) and Task 2 (`inlineStyles`). `buildSnapshotHtml(documentElement,
  getStyle?)` consistent in Task 2 (def + tests) and Task 3 (`runSnapshot` calls
  it with the default getStyle). `getStyle(el)` returns an object with
  `getPropertyValue(prop)` — matches the test stub and the real
  `getComputedStyle`.
- **Test env:** guard test is pure node (existing project); inlining test uses
  `// @vitest-environment happy-dom` (added devDep) with injected `getStyle` so it
  doesn't depend on happy-dom's computed styles.
- **Typecheck scope (known, intentional):** the plugin `tsconfig.json` `include`
  is `["src", …]`, which excludes `bookmarklet/`. So `pnpm --filter plugin
  check-types` does not typecheck `snapshot.js` — it's a plain-JS browser artifact
  (it ends up minified into a `javascript:` URL), exercised by vitest (esbuild),
  not tsc. The `.ts` test files under `bookmarklet/` are likewise outside tsc's
  `include` but run under vitest. This is deliberate: don't add `bookmarklet` to
  the tsconfig `include` (it would pull a plain-JS file into the typed build). The
  guard + happy-dom tests are the safety net here, not tsc.
- **Path check:** the guard test's `join(__dirname,
  "../../../packages/dom-to-figma/src/converter")` resolves correctly —
  `__dirname` is `apps/plugin/bookmarklet`, so `../../../` reaches the repo root.
