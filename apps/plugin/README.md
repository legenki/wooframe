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

Images build via `figma.createImage` (PNG; a failed image keeps its frame and
records a warning). Icon/symbol characters the primary font lacks (e.g. ⌕ ▾ ⋯)
are drawn from a fallback chain (Noto Sans Math → Noto Sans Symbols) instead of
being dropped. Not yet handled: deriving gradient direction from the CSS angle.

## Known limitations (from live Figma testing)

- **Bundled pages unpack (via `allowedDomains`).** Self-unpacking exported
  pages (e.g. SkillATS "Send Test" / "Tests List") inline their fonts but load
  React, ReactDOM, and Babel standalone from `unpkg.com` at unpack time
  (`dc-runtime`). The manifest's `allowedDomains` now lists `https://unpkg.com`
  alongside jsDelivr, so the nested render iframe can fetch them within the
  plugin CSP and the page hydrates before conversion. Confirmed in live Figma
  testing. Bundles that pin a different CDN would need that host added too.
- **System & web-safe fonts resolve to fallbacks.** Generic / system family
  names (`ui-monospace`, `-apple-system`, `system-ui`, `sans-serif`, `serif`,
  `monospace`, …) and web-safe families fontsource doesn't carry (`Arial`,
  `Helvetica`, `Times New Roman`, `Courier New`, `Georgia`, `Tahoma`, `Verdana`)
  are mapped to a fontsource family before any CDN request, so there's no 404
  noise: serif → PT Serif, monospace → Roboto Mono, Arial → Arimo, Times New
  Roman → Tinos, Courier New → Cousine (metric-compatible clones), everything
  else → the configured fallback (Inter by default). The Figma payload still
  claims the original family name, so Figma renders the real font if it's
  installed at the destination.
- **Figma sandbox is QuickJS.** The `code.js` bundle is transpiled to es2017
  (`vite.config.ts`) because `?.`/`??` aren't supported in the sandbox.
