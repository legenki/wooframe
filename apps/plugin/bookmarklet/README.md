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

The live DOM with computed styles inlined onto each element, with
`<script>`/`<noscript>` removed.

Snapshots now inline nearly all computed styles (minus a small blacklist), which
guarantees an identical layout when the converter re-renders them — but makes the
HTML much larger (roughly 5–10× the previous size; several MB on heavy pages).
That's expected for a one-shot capture.

**Not captured:** Shadow DOM, `<canvas>`/WebGL, `<video>`, cross-origin
`<iframe>`, and `::before`/`::after` pseudo-elements (the converter doesn't
render those). Very large pages (>~2000 elements) take ~1–3 s and produce a
multi-MB file — that's expected for a one-shot capture.

## Regenerating the minified string

`snapshot.bookmarklet.txt` is generated from `snapshot.js` by a small build
script (it bundles + minifies via esbuild and URL-encodes the result):

```bash
node apps/plugin/bookmarklet/build.mjs
```

The whitelist of inlined properties (`SNAPSHOT_STYLE_PROPS` in `snapshot.js`) is
kept in sync with the converter by `snapshot-whitelist.test.ts`, which fails the
build if the converter starts reading a property the bookmarklet would drop.
