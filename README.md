# woofigma

Import HTML into **editable Figma layers**. A Figma plugin plus the DOM-to-Figma
conversion stack it's built on.

Point it at an HTML document — pasted markup or an `.html` file — and get a
Figma frame with real text, fills, gradients, shadows, borders, and auto-layout.
Not a flat screenshot: editable layers.

> Not affiliated with or endorsed by Figma.

## What's in here

This is a pnpm monorepo with three projects, layered bottom-up:

| Package | What it does |
| --- | --- |
| [`@woofigma/fig-kiwi`](packages/fig-kiwi) | Low-level codec for Figma's **Kiwi** binary format and the HTML clipboard envelope Figma reads on paste. |
| [`@woofigma/dom-to-figma`](packages/dom-to-figma) | Walks a real DOM tree, reads computed styles, and produces a Figma clipboard payload. Built on `fig-kiwi`. |
| [`apps/plugin`](apps/plugin) | The **Woofigma Import** Figma plugin. Renders HTML in a sandboxed iframe, runs the converter against that live DOM, and maps the result to Figma Plugin API nodes — no clipboard `Cmd+V` step. |

Two ways to use the stack:

- **In the browser / a web app** → depend on `@woofigma/dom-to-figma`, convert a
  DOM tree, and write the result to the clipboard. The user pastes into Figma.
- **Inside Figma** → run the plugin, which does the conversion and builds the
  layers directly on the canvas.

## Quick start

```sh
pnpm install
pnpm build        # build every package + the plugin
pnpm test         # browser-mode vitest across the workspace
pnpm check-types  # tsc --noEmit, all projects
pnpm lint         # biome check
```

Node `>=20` (`.nvmrc` pins 24), pnpm `10.33.2` — see `package.json` `engines`
and `packageManager`.

### Run the plugin in Figma

```sh
pnpm --filter plugin build
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…**,
choose [`apps/plugin/manifest.json`](apps/plugin/manifest.json), and run
**Woofigma Import**. See the [plugin README](apps/plugin/README.md) for the full
load + manual-E2E walkthrough.

### Use the converter in code

```ts
import { createFigmaConverter } from "@woofigma/dom-to-figma";

const figma = createFigmaConverter();
const result = await figma.convert({
  element: document.getElementById("design"),
  width: 1280,
  height: 800,
  name: "Hero",
});

await navigator.clipboard.write([result.toClipboardItem()]);
// Paste in Figma. Done.
```

Custom font / image / classification loaders are documented in the
[`dom-to-figma` README](packages/dom-to-figma/README.md).

## Scope & known limitations

The converter handles frames, text, groups, solid + linear-gradient fills,
drop/inner shadows, corner radius, borders, auto-layout, images, vectors, and
form placeholders. Fonts load from the fontsource CDN (jsDelivr) by default.

Open edges, roughly by increasing effort:

1. **Raster image fills in the plugin** — wire `figma.createImage` so bitmap
   fills land as real images on the canvas.

Earlier limitations now resolved:

- **System / generic font names** (`ui-monospace`, `-apple-system`,
  `sans-serif`, `serif`, `monospace`, …) are mapped to fontsource families
  before any CDN request, so they no longer 404.
- **Web-safe font 404s** — concrete families fontsource doesn't mirror
  (`Arial`/`Helvetica` → Arimo, `Times New Roman` → Tinos, `Courier New` →
  Cousine, `Georgia` → PT Serif, `Tahoma`/`Verdana` → Inter) are pre-mapped to
  metric-compatible families, so they no longer 404 either. The payload keeps
  the requested name, so Figma renders the real font if it's installed.
- **Bundled / self-unpacking pages** (SkillATS-style `dc-runtime` exports that
  load React/ReactDOM/Babel from unpkg at unpack time) now hydrate: the plugin
  manifest's `allowedDomains` includes `https://unpkg.com`, so the nested render
  iframe can fetch them within the plugin CSP.

The plugin sandbox is QuickJS, so `code.ts` is transpiled to es2017
(`?.` / `??` aren't supported there) — see
[`apps/plugin/vite.config.ts`](apps/plugin/vite.config.ts).

## Tooling

Biome (lint/format), Knip (dead-code), Lefthook (git hooks), commitlint
(conventional commits), Vitest in browser mode. Per-package details live in each
project's README and `CHANGELOG.md`.

## License

[MIT](packages/dom-to-figma/LICENSE).
