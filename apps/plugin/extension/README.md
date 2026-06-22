# Woofigma Snapshot — Chrome extension

A toolbar-icon version of the snapshot bookmarklet. Click the icon on any page to
capture its live, rendered DOM (in your own session) as a `woofigma-snapshot.html`
you drop into the Woofigma Figma plugin. Same capture logic as the bookmarklet —
this just trades the bookmark for a toolbar button.

## Build

```bash
node apps/plugin/extension/build-extension.mjs
```

This regenerates `content.js` from the shared `../bookmarklet/snapshot.js`.

## Install (unpacked)

1. Build (above) so `content.js` exists.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `apps/plugin/extension/` folder.

The **Woofigma Snapshot** icon appears in the toolbar.

## Use

1. Navigate to the page you want to import.
2. Click the **Woofigma Snapshot** toolbar icon.
3. A toast shows progress; a `woofigma-snapshot.html` downloads (and is copied to
   the clipboard if the browser allows).
4. In Figma, run the plugin and drop the `.html` onto the drop zone (or Cmd+V).

## What it captures / limits

Identical to the bookmarklet (see `../bookmarklet/README.md`): the live DOM with
computed styles inlined, scripts stripped. Not captured: Shadow DOM,
`<canvas>`/WebGL, `<video>`, cross-origin `<iframe>`, pseudo-elements.

Snapshots now inline nearly all computed styles (minus a small blacklist), which
guarantees an identical layout when the converter re-renders them — but makes the
HTML much larger (roughly 5–10× the previous size; several MB on heavy pages).
That's expected for a one-shot capture.

The extension uses only the `activeTab` and `scripting` permissions — it can read
the current tab only when you click the icon, and never runs in the background.

A one-click Chrome Web Store install would require publishing (developer account
+ Google review) and is out of scope; Load unpacked is the supported path.
