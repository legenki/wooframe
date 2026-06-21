# URL load + screen-size presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two plugin-UI import options — a screen-size preset (iPhone 390 / Macbook 1440) that sets the render width, and load-from-URL via an optional user-supplied CORS proxy template.

**Architecture:** A new pure `url-loader.ts` module (`loadHtmlFromUrl(targetUrl, proxyTemplate?)`) fetches and validates page HTML; it is node-unit-testable with a mocked `fetch`. `render-host.ts` gains a `width` parameter (default 1440). `app.tsx` gains a size toggle and URL/proxy inputs and orchestrates both. The manifest's `allowedDomains` becomes `["*"]` so user-supplied URLs/proxies are reachable.

**Tech Stack:** TypeScript, React (plugin UI), Vitest node project (`src/**/*.test.ts`, `environment: "node"`) with `vi.stubGlobal("fetch", …)` and the global `Response`.

---

## File Structure

- **Create** `apps/plugin/src/ui/url-loader.ts` — `loadHtmlFromUrl`; pure fetch + validation.
- **Create** `apps/plugin/src/ui/url-loader.test.ts` — node unit tests (mocked fetch).
- **Modify** `apps/plugin/src/ui/render-host.ts` — `width` parameter on `renderAndConvert`.
- **Modify** `apps/plugin/src/ui/app.tsx` — size toggle, URL + proxy inputs, orchestration.
- **Modify** `apps/plugin/src/ui/style.css` — minimal styles for the new controls.
- **Modify** `apps/plugin/manifest.json` — `allowedDomains: ["*"]` + reasoning.

Order: `url-loader` (isolated, fully tested) → `render-host` width → `app.tsx` wiring → manifest. The converter and `messages.ts` are untouched.

---

## Task 1: `url-loader.ts` — fetch + validate page HTML

**Files:**
- Create: `apps/plugin/src/ui/url-loader.ts`
- Test: `apps/plugin/src/ui/url-loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/plugin/src/ui/url-loader.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHtmlFromUrl } from "./url-loader";

function stubFetch(
  impl: (url: string) => Response | Promise<Response>
): Array<string> {
  const urls: Array<string> = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    return Promise.resolve(impl(url));
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadHtmlFromUrl", () => {
  it("returns the body for a direct 200 text/html response", async () => {
    stubFetch(
      () =>
        new Response("<!doctype html><html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<body>hi</body>");
  });

  it("substitutes {url} (encoded) into the proxy template", async () => {
    const urls = stubFetch(
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    await loadHtmlFromUrl("https://a.com/x?y=1", "https://p/?url={url}");
    expect(urls[0]).toBe(
      `https://p/?url=${encodeURIComponent("https://a.com/x?y=1")}`
    );
  });

  it("throws on a non-2xx response", async () => {
    stubFetch(() => new Response("nope", { status: 502 }));
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /HTTP 502/
    );
  });

  it("throws when the body is not HTML", async () => {
    stubFetch(
      () =>
        new Response('{"a":1}', {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /did not return HTML/
    );
  });

  it("accepts an HTML body even without a text/html content-type", async () => {
    stubFetch(
      () => new Response("<!DOCTYPE html><html></html>", { status: 200 })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<html>");
  });

  it("propagates a fetch rejection (CORS/network)", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Failed to fetch")));
    await expect(loadHtmlFromUrl("https://example.com")).rejects.toThrow(
      /Failed to fetch/
    );
  });

  it("throws (without fetching) when the proxy template lacks {url}", async () => {
    const urls = stubFetch(() => new Response("<html></html>", { status: 200 }));
    await expect(
      loadHtmlFromUrl("https://example.com", "https://p/no-placeholder")
    ).rejects.toThrow(/\{url\} placeholder/);
    expect(urls).toHaveLength(0);
  });

  it("accepts a parameterized text/html content-type", async () => {
    stubFetch(
      () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
    );
    const html = await loadHtmlFromUrl("https://example.com");
    expect(html).toContain("<html>");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter plugin exec vitest run url-loader.test.ts`
Expected: FAIL — `./url-loader` has no export `loadHtmlFromUrl`.

- [ ] **Step 3: Implement `url-loader.ts`**

Create `apps/plugin/src/ui/url-loader.ts`:

```ts
// Loads page HTML for import. `proxyTemplate` is an optional URL containing the
// literal "{url}", which is replaced with encodeURIComponent(targetUrl). With no
// template, a direct fetch is attempted (works only for CORS-permissive targets).
// Returns the HTML text or throws a descriptive Error.

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType?.toLowerCase().includes("text/html")) {
    return true;
  }
  const head = body.trimStart().slice(0, 9).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

export async function loadHtmlFromUrl(
  targetUrl: string,
  proxyTemplate?: string
): Promise<string> {
  let fetchUrl = targetUrl;
  if (proxyTemplate) {
    if (!proxyTemplate.includes("{url}")) {
      throw new Error("Proxy template must include {url} placeholder.");
    }
    fetchUrl = proxyTemplate.replace("{url}", encodeURIComponent(targetUrl));
  }

  const response = await fetch(fetchUrl);
  if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
    throw new Error(`Failed to load URL (HTTP ${response.status}).`);
  }

  const body = await response.text();
  if (!looksLikeHtml(response.headers.get("content-type"), body)) {
    throw new Error("That URL did not return HTML.");
  }
  return body;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter plugin exec vitest run url-loader.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Format, typecheck**

Run: `pnpm exec biome check --write apps/plugin/src/ui/url-loader.ts apps/plugin/src/ui/url-loader.test.ts && pnpm --filter plugin check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/plugin/src/ui/url-loader.ts apps/plugin/src/ui/url-loader.test.ts
git commit -m "feat(plugin): add loadHtmlFromUrl with optional proxy template"
```

---

## Task 2: `render-host.ts` — width parameter

**Files:**
- Modify: `apps/plugin/src/ui/render-host.ts`

- [ ] **Step 1: Parameterize the render width**

In `apps/plugin/src/ui/render-host.ts`, change the `RENDER_WIDTH` constant into a
default and add a `width` parameter. Replace the constant declaration:

```ts
// Default render width (Macbook preset). Callers override per screen-size choice.
const DEFAULT_RENDER_WIDTH = 1440;
const RENDER_HEIGHT = 4096;
```

(Leave `STABILIZE_MS`, `LOAD_TIMEOUT_MS` as they are. Remove the old
`const RENDER_WIDTH = 1440;` line.)

Change the `renderAndConvert` signature and the iframe width usage:

```ts
export async function renderAndConvert(
  html: string,
  rootName: string,
  width: number = DEFAULT_RENDER_WIDTH
): Promise<RenderResult> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${RENDER_HEIGHT}px;border:0;visibility:hidden`;
  document.body.appendChild(iframe);
```

(The rest of the function is unchanged; the measured `width`/`height` from
`scrollWidth`/`scrollHeight` after layout still drive the converter.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter plugin check-types`
Expected: PASS (existing `renderAndConvert(source, name)` call in `app.tsx`
still compiles because `width` is optional — it is updated in Task 3).

- [ ] **Step 3: Run the plugin suite (no regressions)**

Run: `pnpm --filter plugin exec vitest run`
Expected: PASS (no render-host unit test exists; this just confirms nothing
else broke).

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/src/ui/render-host.ts
git commit -m "feat(plugin): parameterize render width"
```

---

## Task 3: `app.tsx` — size toggle + URL/proxy inputs

**Files:**
- Modify: `apps/plugin/src/ui/app.tsx`
- Modify: `apps/plugin/src/ui/style.css`

- [ ] **Step 1: Add the screen-size presets and state**

In `apps/plugin/src/ui/app.tsx`, just below the existing `const HTML_EXT` line,
add the presets:

```ts
const SCREEN_PRESETS = [
  { label: "iPhone", width: 390 },
  { label: "Macbook", width: 1440 },
] as const;
```

Inside `App()`, add state next to the existing `useState` hooks:

```ts
  const [width, setWidth] = useState(1440);
  const [url, setUrl] = useState("");
  const [proxy, setProxy] = useState("");
```

- [ ] **Step 2: Thread width into runImport**

Replace the existing `runImport` so it passes `width` to `renderAndConvert`:

```ts
  async function runImport(source: string) {
    setBusy(true);
    setIsError(false);
    setStatus("Rendering and converting…");
    try {
      const { nodeChanges, rootName, blobs } = await renderAndConvert(
        source,
        name,
        width
      );
      post({ type: "import-nodes", nodeChanges, rootName, blobs });
    } catch (error) {
      setBusy(false);
      setIsError(true);
      setStatus(`Convert failed: ${(error as Error).message}`);
    }
  }
```

- [ ] **Step 3: Add the URL import handler**

Add a new handler inside `App()` (after `onFile`), importing `loadHtmlFromUrl`:

```ts
  async function onImportUrl() {
    setBusy(true);
    setIsError(false);
    setStatus("Loading URL…");
    try {
      const loaded = await loadHtmlFromUrl(url, proxy || undefined);
      setHtml(loaded);
      await runImport(loaded);
    } catch (error) {
      setBusy(false);
      setIsError(true);
      setStatus(
        `Couldn't load that URL. The site or your proxy blocked the request (CORS). Try a different proxy or save the page as an .html file. (${(error as Error).message})`
      );
    }
  }
```

And add the import at the top of the file:

```ts
import { loadHtmlFromUrl } from "./url-loader";
```

- [ ] **Step 4: Add the size toggle + URL UI to the render**

In the returned JSX, add a size toggle above the drop button, and a URL block
below the textarea (before the "Import to Figma" button). Insert this size
toggle as the first child inside the root `<div>`:

```tsx
      <div className="sizes">
        {SCREEN_PRESETS.map((p) => (
          <button
            className={width === p.width ? "size active" : "size"}
            key={p.label}
            onClick={() => setWidth(p.width)}
            type="button"
          >
            {p.label}
          </button>
        ))}
      </div>
```

And insert this URL block immediately before the existing "Import to Figma"
button:

```tsx
      <input
        className="url"
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com to load by URL"
        type="url"
        value={url}
      />
      <input
        className="url"
        onChange={(e) => setProxy(e.target.value)}
        placeholder="Optional CORS proxy, e.g. https://your-proxy/?url={url}"
        type="text"
        value={proxy}
      />
      <button
        disabled={busy || !url.trim()}
        onClick={() => run(onImportUrl())}
        type="button"
      >
        {busy ? "Importing…" : "Import from URL"}
      </button>
```

- [ ] **Step 5: Add styles**

Append to `apps/plugin/src/ui/style.css`:

```css
.sizes {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.size {
  flex: 1;
  margin-top: 0;
  color: #1e1e1e;
  background: #f0f0f0;
}
.size.active {
  color: #fff;
  background: #0d99ff;
}
.url {
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  font: inherit;
}
```

- [ ] **Step 6: Typecheck + build + run suite**

Run: `pnpm --filter plugin check-types && pnpm --filter plugin exec vitest run && pnpm --filter plugin build`
Expected: PASS; build emits `dist/code.js` + `dist/index.html`.

- [ ] **Step 7: Lint**

Run: `pnpm exec biome check apps/plugin/src/ui/app.tsx`
Expected: no errors (infos/warnings non-blocking).

- [ ] **Step 8: Commit**

```bash
git add apps/plugin/src/ui/app.tsx apps/plugin/src/ui/style.css
git commit -m "feat(plugin): screen-size presets and load-from-URL UI"
```

---

## Task 4: manifest `allowedDomains: ["*"]`

**Files:**
- Modify: `apps/plugin/manifest.json`

- [ ] **Step 1: Widen allowedDomains with reasoning**

In `apps/plugin/manifest.json`, replace the `networkAccess` block:

```json
  "networkAccess": {
    "allowedDomains": ["*"],
    "reasoning": "[\"*\"] is required for two reasons: (1) loading webfonts from fontsource (jsDelivr) and React/ReactDOM/Babel from unpkg for bundled pages, and (2) the Load-from-URL feature, where the user supplies an arbitrary page URL and an optional CORS proxy — neither host is known ahead of time, so the domains cannot be pre-listed."
  }
```

- [ ] **Step 2: Rebuild so dist picks up the manifest (manifest is read directly, but rebuild for consistency)**

Run: `pnpm --filter plugin build`
Expected: build succeeds.

- [ ] **Step 3: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/plugin/manifest.json','utf8')); console.log('manifest ok')"`
Expected: `manifest ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/manifest.json
git commit -m "feat(plugin): allow all domains for user-supplied URLs/proxies"
```

---

## Task 5: README — document the new import options

**Files:**
- Modify: `apps/plugin/README.md`

- [ ] **Step 1: Document URL + screen-size in the plugin README**

In `apps/plugin/README.md`, under the "Manual E2E" or "Scope" area, add a short
paragraph (place it right after the `## Load in Figma` section's steps, before
`## Manual E2E`):

```markdown
## Import options

Three ways to provide HTML: drop/choose an `.html` file, paste markup, or enter a
URL. URL loading fetches the page from the plugin UI, so it only works for
CORS-permissive sites; for everything else, supply a CORS proxy template whose
`{url}` placeholder is replaced with the page URL (e.g.
`https://your-proxy/?url={url}`). Private/authenticated pages can't be loaded
this way — save them as `.html` and drop them instead.

A screen-size toggle (iPhone 390 / Macbook 1440, default Macbook) sets the render
viewport width before conversion.
```

- [ ] **Step 2: Commit**

```bash
git add apps/plugin/README.md
git commit -m "docs: document URL load and screen-size options"
```

---

## Self-Review

- **Spec coverage:** screen-size presets + width param (Tasks 2, 3) ✓;
  `loadHtmlFromUrl` with proxy template, `{url}` validation, non-2xx, non-HTML,
  content-type-substring, CORS propagation (Task 1, 8 tests covering spec tests
  1–8) ✓; `app.tsx` URL+proxy inputs, disabled-when-empty, persist-on-error,
  proxy hint (Task 3) ✓; `allowedDomains: ["*"]` + reasoning (Task 4) ✓; README
  (Task 5) ✓.
- **Placeholders:** none — all code concrete.
- **Type consistency:** `loadHtmlFromUrl(targetUrl: string, proxyTemplate?:
  string): Promise<string>` is identical in Task 1 (def) and Task 3 (call,
  passing `proxy || undefined`). `renderAndConvert(html, rootName, width?: number)`
  consistent in Task 2 (def) and Task 3 (call with `width`). `SCREEN_PRESETS`
  `{ label, width }` shape matches its use in the toggle.
- **Test env note:** the plugin vitest config is node-only (`environment:
  "node"`, glob `src/**/*.test.ts`), so `url-loader.test.ts` runs in node with a
  stubbed global `fetch` and the global `Response` (Node 20+ / undici) — matching
  the existing `dom-to-figma` `loader.test.ts` mock pattern.
- **Persist-on-error:** `onImportUrl`'s catch sets status only; `url`/`proxy`
  state is never reset, so inputs persist (spec requirement) without extra code.
