# Woofigma Import (Figma plugin)

Import an HTML file (or pasted markup) into editable Figma layers — entirely
inside Figma, no clipboard `Cmd+V` step.

Built on [`@woofigma/dom-to-figma`](../../packages/dom-to-figma): the plugin UI
renders the HTML in a nested sandbox iframe, runs the converter against that
live DOM, and the sandbox (`code.ts`) maps the resulting `FigmaNodeChange[]`
to Plugin API nodes.

## Build

```sh
pnpm --filter plugin build
```

Produces two self-contained artifacts in `apps/plugin/dist/`:

- `code.js` — the sandbox entry (IIFE)
- `index.html` — the UI, with all JS/CSS inlined (via `vite-plugin-singlefile`)

`pnpm --filter plugin dev` rebuilds the UI on change.

## Load in Figma

1. Figma desktop → Plugins → Development → **Import plugin from manifest…**
2. Choose `apps/plugin/manifest.json`.
3. Run **Woofigma Import** from Plugins → Development.

## Manual E2E

1. Run the plugin. Paste a static HTML document (with inline styles) into the
   textarea, or drop/choose an `.html` file.
2. Confirm a frame named after the import appears on the canvas with editable
   text, fills, and shadows.
3. Confirm the status line reports `Built N of M layers` and lists any missing
   fonts.

## Scope (V1)

Frames, text, groups; solid + linear-gradient fills; drop/inner shadows; corner
radius; borders; auto-layout; fonts via `loadFontAsync` with an Inter fallback.

Not yet handled: images (`createImage`), per-character icon-font glyph
coverage, and deriving gradient direction from the CSS angle.

## Known limitations (from live Figma testing)

- **Bundled pages don't unpack.** Self-unpacking exported pages (e.g. SkillATS
  "Send Test") run an inline script that loads React from `unpkg.com`. Figma's
  plugin CSP (`script-src ... https://cdn.jsdelivr.net`) blocks that domain, so
  the unpacker errors and the plugin imports its error banner instead of the
  page. Static HTML imports correctly. Resolving this means either widening the
  manifest `allowedDomains` to the CDNs those pages use, or unpacking bundles
  outside the plugin CSP.
- **System fonts 404 on the CDN.** Names like `ui-monospace` / `Inter` are
  requested from the fontsource CDN; system fonts aren't there, producing 404
  noise before the Inter fallback kicks in. A name→fallback map applied before
  the CDN request would remove the noise.
- **Figma sandbox is QuickJS.** The `code.js` bundle is transpiled to es2017
  (`vite.config.ts`) because `?.`/`??` aren't supported in the sandbox.
