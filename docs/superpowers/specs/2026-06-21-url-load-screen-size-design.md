# URL load + screen-size presets — design

**Date:** 2026-06-21
**Package:** `apps/plugin` (UI + render host; converter unchanged)
**Status:** Approved, pending implementation

## Summary

Two related additions to the plugin's import UI:

1. **Screen-size presets** — pick the render viewport width (iPhone 390 /
   Macbook 1440) instead of the current hardcoded 1440. Reliable, no external
   dependency.
2. **Load from URL** — fetch a page's HTML and import it. Because the plugin runs
   under Figma's CSP + browser CORS, a direct fetch only works for
   CORS-permissive sites; for everything else the user supplies a CORS proxy
   URL. Best-effort by nature.

## Constraints (verified)

- The plugin UI fetches under Figma's `networkAccess` CSP. `["*"]` is a valid
  `allowedDomains` value (Figma manifest docs) and **requires** the `reasoning`
  field (already present). The user is not publishing to Figma Community, so the
  broad scope is acceptable.
- Browser **CORS** still applies regardless of CSP: a cross-origin `fetch` only
  succeeds if the target (or proxy) returns `Access-Control-Allow-Origin`. Most
  sites do not. Public free CORS proxies were tested and found unreliable
  (corsproxy.io now paid; codetabs/allorigins/thingproxy 400/down). So we do
  **not** hardcode a proxy — the user provides one.

## Feature 1: screen-size presets

- `app.tsx` gains a segmented toggle with `SCREEN_PRESETS = [{ label: "iPhone",
  width: 390 }, { label: "Macbook", width: 1440 }]`, default Macbook (matches the
  current 1440 default).
- The chosen width flows into `renderAndConvert(source, name, width)`.
- `render-host.ts`: the hardcoded `RENDER_WIDTH` becomes the `width` parameter
  (default 1440 to preserve current behavior). `RENDER_HEIGHT` (4096) stays as a
  generous pre-measurement ceiling; final height is still `scrollHeight`.

This is self-contained and has no external dependency.

## Feature 2: load from URL

New module **`apps/plugin/src/ui/url-loader.ts`**:

```ts
// Loads page HTML for import. `proxyTemplate` is an optional URL containing the
// literal "{url}", which is replaced with encodeURIComponent(targetUrl). With
// no template, a direct fetch is attempted (works only for CORS-permissive
// targets). Returns the HTML text or throws a descriptive Error.
export async function loadHtmlFromUrl(
  targetUrl: string,
  proxyTemplate?: string
): Promise<string>;
```

Behavior:

1. Build the fetch URL:
   - If `proxyTemplate` is provided, it **must** contain the literal `{url}`.
     If it doesn't, throw `Proxy template must include {url} placeholder.`
     immediately (before any fetch) — don't silently fall back to a direct
     fetch, which would surprise the user who configured a proxy.
   - With a valid template, replace `{url}` with `encodeURIComponent(targetUrl)`.
   - With no template, fetch `targetUrl` directly.
2. `fetch` it (redirects follow by default — fine; no size cap, since the render
   viewport ceiling `RENDER_HEIGHT` already bounds what gets measured). On a
   non-2xx response, throw `Failed to load URL (HTTP <status>).`.
3. Read the body text. Accept it as HTML if the `content-type` header contains
   `text/html` (matched as a substring, so `text/html; charset=utf-8` and other
   parameterized values pass) **or** the trimmed body starts (case-insensitive)
   with `<!doctype` or `<html` (some proxies omit a correct content-type).
   Otherwise throw `That URL did not return HTML.`.
4. A thrown `fetch` (CORS/network) propagates as an Error; `app.tsx` shows a
   descriptive message.

`app.tsx`:

- A **URL** text input plus a **Proxy template** input (placeholder
  `https://your-proxy/?url={url}`, with a one-line hint such as *"Optional CORS
  proxy. `{url}` is replaced with the page URL."*). An **"Import from URL"**
  button calls `loadHtmlFromUrl(url, proxyTemplate || undefined)`, then the
  existing `runImport(html)` path (now passing the selected width).
- The "Import from URL" button is **disabled while the URL field is empty** (and
  while `busy`), mirroring the existing "Import to Figma" button's
  `disabled={busy || !html.trim()}`.
- On failure the URL and proxy inputs are **left populated** (they are plain
  React state, not cleared on error) so the user can fix and retry.
- Error copy on failure: *"Couldn't load that URL. The site or your proxy blocked
  the request (CORS). Try a different proxy or save the page as an .html file."*

### Manifest

`allowedDomains: ["*"]` (the proxy domain is user-supplied and unknown ahead of
time). The `reasoning` must justify the broad scope clearly, e.g.:

> `["*"]` is required for two reasons: (1) loading webfonts from fontsource
> (jsDelivr) and React/Babel from unpkg for bundled pages, and (2) the
> "Load from URL" feature, where the user supplies an arbitrary page URL and an
> optional CORS proxy — neither host is known ahead of time, so the domains
> cannot be pre-listed.

## Unit boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `url-loader.ts` | Fetch + validate HTML from a URL/proxy | `fetch` |
| `render-host.ts` | Render at a given width, convert | converter |
| `app.tsx` | UI: size toggle, URL/proxy inputs, orchestration | both above |

`messages.ts` is unchanged (the import message already carries
`nodeChanges`/`rootName`/`blobs`).

## Error handling

- URL load failure (non-2xx, non-HTML, CORS/network) → caught in `app.tsx`,
  shown as the descriptive status above; nothing is posted to the sandbox.
- Screen-size has no failure mode of its own.

## Testing

`url-loader.test.ts` (node unit, mocked `fetch`):

1. Direct fetch returns 200 `text/html` → resolves with the body.
2. Proxy template with `{url}` → fetch is called with the substituted,
   URL-encoded address; returns body.
3. Non-2xx → throws `Failed to load URL (HTTP …)`.
4. 200 but `application/json` and body not HTML-looking → throws `did not return
   HTML`.
5. 200 with no/!html content-type but body starts with `<!doctype html>` →
   accepted (resolves).
6. `fetch` rejecting (simulated CORS/network) → error propagates.
7. `proxyTemplate` without `{url}` → throws `Proxy template must include {url}
   placeholder.` and `fetch` is **never called**.
8. 200 with `content-type: text/html; charset=utf-8` (parameterized) → accepted.

`render-host` width is covered indirectly; no new render-host test (its iframe
needs a browser and the width change is a literal substitution). `app.tsx` is not
unit-tested (consistent with the current codebase, which has no app.tsx test).

## Out of scope

- A bundled/hosted proxy (user supplies their own).
- Auth'd/private pages (a public proxy can't reach them).
- Per-preset height — height stays auto (`scrollHeight`).
- Custom arbitrary width input (only the two presets).
- A preview of the loaded URL before import — on success we go straight to
  `runImport`, matching the file/paste flows (which also import immediately).
