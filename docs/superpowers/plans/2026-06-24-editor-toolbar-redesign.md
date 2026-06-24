# Editor Toolbar & Sticky-Note Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the annotation editor's bottom toolbar (Phosphor SVG icons, Figma-like styling, light/dark theme) and the sticky notes it creates (rounded corners, soft shadow, new anchor icon, dark theme), and replace the point-and-click "remove highlight" button with a single "Clear all" button that wipes all notes and highlights.

**Architecture:** The toolbar lives in the top-level extension page (`editor.html` + `editor.css` + `ui-editor.js`). The annotated content and sticky notes live inside a sandboxed iframe driven by the vendored `lib/single-file-extension-editor.js`. The toolbar talks to the iframe via `postMessage`. We swap PNG `<img>` buttons for inline Phosphor `<svg>` buttons, add a new `removeAllAnnotations` message handler in the vendored lib (reusing its existing note-removal and highlight-unwrap primitives), swap the note anchor icon constant, and restyle via CSS with `prefers-color-scheme` for both the toolbar and the notes.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS, Chrome MV3 extension, Phosphor Icons (vendored SVG). No build step or test runner covers `extension/` (biome ignores it); verification is manual in the loaded extension plus `node --check` syntax checks.

---

## Important context for the implementer

**No automated tests exist for this code.** `extension/` is biome-ignored and the UI runs inside a sandboxed iframe, so there is no unit-test harness. Each task is verified by:
1. `node --check <file>` for any edited `.js` file (syntax safety).
2. Manual verification in the loaded extension (steps spelled out per task).

**How to load the extension for manual verification** (do this once, before Task 1, keep it open):
- Build/sync the extension if the project requires it. From repo root check whether `apps/plugin/extension` is loaded directly or built. If a build is needed: `pnpm -r run build` (only if the plugin package defines it; otherwise the `extension/` folder is loaded as-is).
- Open `chrome://extensions`, enable Developer mode, "Load unpacked" → select `apps/plugin/extension`.
- Trigger the editor: click the extension icon on any page (per recent commit `44fabde`, the icon opens the editor directly). The bottom toolbar is the panel under review.
- After each code change, click the reload (↻) icon on the extension card, then re-open the editor.

**Exact facts established from the code (do not re-derive):**
- Note color classes are `note-red`, `note-green`, `note-blue`, sent via `postMessage({method:"addNote", color:"note-<x>"})` from `ui-editor.js:70-72`.
- Note color backgrounds are defined in `editor-note-web.css` (`.note-red header`/`.note-red blockquote`, etc.) — **NOT** in the lib. Theming notes = editing that CSS only.
- A single note is removed in the lib by `containerElement.remove()` (`single-file-extension-editor.js:3194`).
- A single highlight is removed in the lib by `resetHighlightedElement(el)` applied to every element sharing `data-singlefile-highlight-id` (`single-file-extension-editor.js:3322-3323`).
- The message dispatcher is the `window.onmessage` chain starting at `single-file-extension-editor.js:2711`; add the new handler there.
- The note anchor icon is `BUTTON_ANCHOR_URL` (`single-file-extension-editor.js:2667`), a base64 PNG assigned at `anchorIconElement.src` (`:3110`).
- `ui-editor.js` selectors that MUST be preserved as classes: `.add-note-red-button`, `.add-note-green-button`, `.add-note-blue-button`, `.toggle-notes-button`, `.highlight-button` (+ `.highlight-red-button`/`green`/`blue` + `data-color`), `.toggle-highlights-button`, `.save-page-button`, `.move-to-figma-button`.

---

## File Structure

| File | Change |
|------|--------|
| `apps/plugin/extension/src/ui/resources/icons/*.svg` | **Create** — vendored Phosphor SVGs (sticker, eye-slash, pencil-simple, pencil-simple-slash, broom, download-simple, figma-logo, anchor-simple) |
| `apps/plugin/extension/src/ui/pages/editor.html` | **Modify** — replace `<img>` buttons with inline `<svg>` buttons; broom replaces remove-highlight |
| `apps/plugin/extension/src/ui/pages/editor.css` | **Modify** — Figma-like toolbar, SVG icon styling, 3-color icons, light/dark theme |
| `apps/plugin/extension/src/ui/bg/ui-editor.js` | **Modify** — remove remove-highlight logic; add clear-all (broom) handler; drop `.src` swaps for toggle icons (now class-based) |
| `apps/plugin/extension/src/ui/pages/editor-note-web.css` | **Modify** — rounded corners, soft shadow, anchor sizing, dark theme for notes |
| `apps/plugin/extension/lib/single-file-extension-editor.js` | **Modify** — add `removeAllAnnotations` handler; swap `BUTTON_ANCHOR_URL` to anchor-simple SVG data-URI |

---

## Task 1: Vendor the Phosphor SVG icon assets

**Files:**
- Create: `apps/plugin/extension/src/ui/resources/icons/sticker.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/eye-slash.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/pencil-simple.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/pencil-simple-slash.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/broom.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/download-simple.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/figma-logo.svg`
- Create: `apps/plugin/extension/src/ui/resources/icons/anchor-simple.svg`

These are reference copies kept on disk for provenance. The actual rendering inlines the same paths into HTML/CSS in later tasks. The source SVGs were provided by the user under `~/Downloads/`.

- [ ] **Step 1: Create the icons directory and copy the 8 source SVGs**

```bash
mkdir -p apps/plugin/extension/src/ui/resources/icons
cp ~/Downloads/sticker.svg               apps/plugin/extension/src/ui/resources/icons/sticker.svg
cp ~/Downloads/eye-slash.svg             apps/plugin/extension/src/ui/resources/icons/eye-slash.svg
cp ~/Downloads/pencil-simple.svg         apps/plugin/extension/src/ui/resources/icons/pencil-simple.svg
cp ~/Downloads/pencil-simple-slash.svg   apps/plugin/extension/src/ui/resources/icons/pencil-simple-slash.svg
cp ~/Downloads/broom.svg                 apps/plugin/extension/src/ui/resources/icons/broom.svg
cp ~/Downloads/download-simple.svg       apps/plugin/extension/src/ui/resources/icons/download-simple.svg
cp ~/Downloads/figma-logo.svg            apps/plugin/extension/src/ui/resources/icons/figma-logo.svg
cp ~/Downloads/anchor-simple.svg         apps/plugin/extension/src/ui/resources/icons/anchor-simple.svg
```

- [ ] **Step 2: Verify all 8 files exist**

Run: `ls apps/plugin/extension/src/ui/resources/icons/`
Expected: the 8 `.svg` filenames listed above.

- [ ] **Step 3: Normalize each SVG for inlining (set `fill="currentColor"`, drop fixed width/height)**

For every file in the icons dir, change the root `<svg>` so it inherits color and scales via CSS. Replace `fill="#000000"` with `fill="currentColor"` and remove the `width="32" height="32"` attributes (keep `viewBox="0 0 256 256"`). Concretely each file's opening tag becomes:

```
<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256">
```

(The inner `<path .../>` is unchanged.)

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/extension/src/ui/resources/icons/
git commit -m "feat(extension): vendor Phosphor SVG icons for editor toolbar"
```

---

## Task 2: Replace toolbar markup with inline SVG buttons

**Files:**
- Modify: `apps/plugin/extension/src/ui/pages/editor.html:19-50`

Replaces the `<div class="toolbar">` block. Each button becomes `<button type="button" class="tb-btn ...">` wrapping the inline SVG. All JS-required classes are preserved. The remove-highlight button is replaced by a clear-all (broom) button. Toggle buttons no longer carry `src` (state will be class-driven in Task 4).

- [ ] **Step 1: Replace the toolbar block**

Replace lines 19-50 (`<div class="toolbar"> ... </div>`) in `editor.html` with the following. Each SVG is the normalized Phosphor path from Task 1, inlined.

```html
<div class="toolbar">
    <div class="buttons">
        <button type="button" class="tb-btn add-note-red-button note-color-red">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M168,32H88A56.06,56.06,0,0,0,32,88v80a56.06,56.06,0,0,0,56,56h48a8.07,8.07,0,0,0,2.53-.41c26.23-8.75,76.31-58.83,85.06-85.06A8.07,8.07,0,0,0,224,136V88A56.06,56.06,0,0,0,168,32ZM48,168V88A40,40,0,0,1,88,48h80a40,40,0,0,1,40,40v40H184a56.06,56.06,0,0,0-56,56v24H88A40,40,0,0,1,48,168Zm96,35.14V184a40,40,0,0,1,40-40h19.14C191,163.5,163.5,191,144,203.14Z"></path></svg>
        </button>
        <button type="button" class="tb-btn add-note-green-button note-color-green">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M168,32H88A56.06,56.06,0,0,0,32,88v80a56.06,56.06,0,0,0,56,56h48a8.07,8.07,0,0,0,2.53-.41c26.23-8.75,76.31-58.83,85.06-85.06A8.07,8.07,0,0,0,224,136V88A56.06,56.06,0,0,0,168,32ZM48,168V88A40,40,0,0,1,88,48h80a40,40,0,0,1,40,40v40H184a56.06,56.06,0,0,0-56,56v24H88A40,40,0,0,1,48,168Zm96,35.14V184a40,40,0,0,1,40-40h19.14C191,163.5,163.5,191,144,203.14Z"></path></svg>
        </button>
        <button type="button" class="tb-btn add-note-blue-button note-color-blue">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M168,32H88A56.06,56.06,0,0,0,32,88v80a56.06,56.06,0,0,0,56,56h48a8.07,8.07,0,0,0,2.53-.41c26.23-8.75,76.31-58.83,85.06-85.06A8.07,8.07,0,0,0,224,136V88A56.06,56.06,0,0,0,168,32ZM48,168V88A40,40,0,0,1,88,48h80a40,40,0,0,1,40,40v40H184a56.06,56.06,0,0,0-56,56v24H88A40,40,0,0,1,48,168Zm96,35.14V184a40,40,0,0,1,40-40h19.14C191,163.5,163.5,191,144,203.14Z"></path></svg>
        </button>
        <button type="button" class="tb-btn toggle-notes-button">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"></path></svg>
        </button>
        <div class="separator"></div>
    </div>
    <div class="buttons">
        <button type="button" class="tb-btn highlight-button highlight-red-button highlight-disabled note-color-red" data-color="red">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"></path></svg>
        </button>
        <button type="button" class="tb-btn highlight-button highlight-green-button highlight-disabled note-color-green" data-color="green">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"></path></svg>
        </button>
        <button type="button" class="tb-btn highlight-button highlight-blue-button highlight-disabled note-color-blue" data-color="blue">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"></path></svg>
        </button>
        <button type="button" class="tb-btn toggle-highlights-button">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38l48.2,53L36.68,152A15.89,15.89,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31l50.4-50.39,47.69,52.46a8,8,0,1,0,11.84-10.76ZM92.69,208H48V163.31l53.06-53,42.56,46.81ZM227.32,73.37,182.63,28.69a16,16,0,0,0-22.63,0L118.33,70.36a8,8,0,0,0,11.32,11.31L136,75.31,180.69,120l-9,9A8,8,0,0,0,183,140.34L227.32,96A16,16,0,0,0,227.32,73.37ZM192,108.69,147.32,64l24-24L216,84.69Z"></path></svg>
        </button>
        <div class="separator"></div>
    </div>
    <div class="buttons">
        <button type="button" class="tb-btn clear-all-button">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M235.5,216.81c-22.56-11-35.5-34.58-35.5-64.8V134.73a15.94,15.94,0,0,0-10.09-14.87L165,110a8,8,0,0,1-4.48-10.34l21.32-53a28,28,0,0,0-16.1-37,28.14,28.14,0,0,0-35.82,16,.61.61,0,0,0,0,.12L108.9,79a8,8,0,0,1-10.37,4.49L73.11,73.14A15.89,15.89,0,0,0,55.74,76.8C34.68,98.45,24,123.75,24,152a111.45,111.45,0,0,0,31.18,77.53A8,8,0,0,0,61,232H232a8,8,0,0,0,3.5-15.19ZM67.14,88l25.41,10.3a24,24,0,0,0,31.23-13.45l21-53c2.56-6.11,9.47-9.27,15.43-7a12,12,0,0,1,6.88,15.92L145.69,93.76a24,24,0,0,0,13.43,31.14L184,134.73V152c0,.33,0,.66,0,1L55.77,101.71A108.84,108.84,0,0,1,67.14,88Zm48,128a87.53,87.53,0,0,1-24.34-42,8,8,0,0,0-15.49,4,105.16,105.16,0,0,0,18.36,38H64.44A95.54,95.54,0,0,1,40,152a85.9,85.9,0,0,1,7.73-36.29l137.8,55.12c3,18,10.56,33.48,21.89,45.16Z"></path></svg>
        </button>
        <button type="button" class="tb-btn save-page-button">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"></path></svg>
        </button>
        <button type="button" class="tb-btn move-to-figma-button">
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 256 256"><path d="M192,96a40,40,0,0,0-24-72H96A40,40,0,0,0,72,96a40,40,0,0,0,1.37,65A44,44,0,1,0,144,196V160a40,40,0,1,0,48-64Zm0-32a24,24,0,0,1-24,24H144V40h24A24,24,0,0,1,192,64ZM72,64A24,24,0,0,1,96,40h32V88H96A24,24,0,0,1,72,64Zm24,88a24,24,0,0,1,0-48h32v48H96Zm32,44a28,28,0,1,1-28-28h28Zm40-44a24,24,0,1,1,24-24A24,24,0,0,1,168,152Z"></path></svg>
        </button>
    </div>
</div>
```

- [ ] **Step 2: Verify the buttons render and the old PNGs are gone**

Reload the extension, open the editor. Expected: 10 buttons in 3 groups; no broken-image icons; broom appears where the old delete icon was. (Buttons will look unstyled until Task 3 — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add apps/plugin/extension/src/ui/pages/editor.html
git commit -m "feat(extension): use inline Phosphor SVG buttons in editor toolbar"
```

---

## Task 3: Restyle the toolbar (Figma-like, 3-color icons, light/dark)

**Files:**
- Modify: `apps/plugin/extension/src/ui/pages/editor.css` (replace the `.toolbar`/`.buttons`/`img[type=button]`/`.separator` rules and the dark-theme block)

The old rules target `img[type=button]`; buttons are now `<button class="tb-btn">` with child `<svg>`. Replace styling accordingly. Neutral icons use `currentColor` from the toolbar color; the three note/highlight colors are fixed via `.note-color-red/green/blue`. Active state for highlight/toggle uses `.is-active`.

- [ ] **Step 1: Replace toolbar styles**

In `editor.css`, replace everything from `.toolbar {` (line 15) through the end of the dark-theme `@media (prefers-color-scheme: dark)` block (line 124) with:

```css
.toolbar {
    display: flex;
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    gap: 4px;
    padding: 6px;
    z-index: 9999;
    color: #1e1e1e;
    background: #ffffff;
    border: 1px solid #e6e6e6;
    border-radius: 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08);
}

.buttons {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
}

.tb-btn {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    color: inherit;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.tb-btn svg {
    width: 20px;
    height: 20px;
    display: block;
    pointer-events: none;
}

.note-color-red {
    color: #e5484d;
}

.note-color-green {
    color: #30a46c;
}

.note-color-blue {
    color: #0091ff;
}

@media (hover: hover) {
    .tb-btn:hover {
        background-color: rgba(0, 0, 0, 0.06);
    }
}

.tb-btn.is-active {
    background-color: rgba(0, 145, 255, 0.14);
    color: #0091ff;
}

.tb-btn.highlight-disabled {
    opacity: 0.55;
}

@media (hover: hover) {
    .tb-btn.highlight-disabled:hover {
        opacity: 1;
    }
}

.separator {
    width: 1px;
    height: 20px;
    background-color: #e6e6e6;
    margin: 0 4px;
}

.editor-container {
    position: relative;
    display: flex;
    flex: auto;
    width: 100%;
    height: 100vh;
}

.editor {
    background-color: transparent;
    flex: auto;
    border: none;
}

@media (prefers-color-scheme: dark) {
    body {
        background-color: #1e1e1e;
    }

    .toolbar {
        color: #e6e6e6;
        background: #2c2c2c;
        border: 1px solid #3d3d3d;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }

    .note-color-red {
        color: #ff6369;
    }

    .note-color-green {
        color: #3dd68c;
    }

    .note-color-blue {
        color: #52a9ff;
    }

    @media (hover: hover) {
        .tb-btn:hover {
            background-color: rgba(255, 255, 255, 0.08);
        }
    }

    .tb-btn.is-active {
        background-color: rgba(82, 169, 255, 0.2);
        color: #52a9ff;
    }

    .separator {
        background-color: #3d3d3d;
    }
}
```

- [ ] **Step 2: Verify toolbar appearance in light theme**

Set OS to light theme. Reload extension, open editor. Expected: compact white pill, soft shadow, rounded; the 3 note icons are red/green/blue, 3 highlight pencils red/green/blue; toggle/broom/save/figma icons are dark-neutral; hover shows a subtle gray pill.

- [ ] **Step 3: Verify toolbar appearance in dark theme**

Switch OS to dark theme (no reload needed; `prefers-color-scheme` is live). Expected: dark `#2c2c2c` pill, light neutral icons, color icons brightened; hover pill is subtle white.

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/extension/src/ui/pages/editor.css
git commit -m "feat(extension): Figma-style toolbar with themed SVG icons"
```

---

## Task 4: Rework toolbar JS — class-based toggles, drop remove-highlight, wire clear-all

**Files:**
- Modify: `apps/plugin/extension/src/ui/bg/ui-editor.js:42-126` (selectors, titles, handlers) and `:485-499` (helper functions)

Changes:
1. Replace `removeHighlightButton` with `clearAllButton`.
2. Toggle buttons no longer swap `.src` (no PNG); they toggle an `.is-active` class and track state via that class.
3. Highlight active state shows via `.is-active` in addition to existing `highlight-disabled` toggling (which the CSS already styles); keep the `highlight-disabled` logic intact since other code reads it.
4. Remove all remove-highlight-mode code.

- [ ] **Step 1: Update selectors (lines 46-54 region)**

Replace the `removeHighlightButton` selector line:

```javascript
const removeHighlightButton = document.querySelector(".remove-highlight-button");
```

with:

```javascript
const clearAllButton = document.querySelector(".clear-all-button");
```

- [ ] **Step 2: Update titles (lines 64-68 region)**

Replace:

```javascript
removeHighlightButton.title = browser.i18n.getMessage("editorRemoveHighlight");
```

with:

```javascript
clearAllButton.title = "Clear all notes and highlights";
```

- [ ] **Step 3: Replace the highlight-button handler to drop remove-highlight-mode and set active class (lines 80-94)**

Replace the `highlightButtons.forEach(...)` block with:

```javascript
highlightButtons.forEach(highlightButton => {
	highlightButton.onmouseup = () => {
		const disabled = highlightButton.classList.contains("highlight-disabled");
		resetHighlightButtons();
		if (disabled) {
			highlightButton.classList.remove("highlight-disabled");
			highlightButton.classList.add("is-active");
			editorElement.contentWindow.postMessage(JSON.stringify({ method: "enableHighlight", color: "single-file-highlight-" + highlightButton.dataset.color }), "*");
		} else {
			highlightButton.classList.add("highlight-disabled");
			highlightButton.classList.remove("is-active");
		}
	};
});
```

- [ ] **Step 4: Replace the toggle-notes handler (lines 95-103) to be class-based**

Replace with:

```javascript
toggleNotesButton.onmouseup = () => {
	const hidden = toggleNotesButton.classList.toggle("is-active");
	editorElement.contentWindow.postMessage(JSON.stringify({ method: hidden ? "hideNotes" : "displayNotes" }), "*");
};
```

- [ ] **Step 5: Replace the toggle-highlights handler (lines 104-111) to be class-based**

Replace with:

```javascript
toggleHighlightsButton.onmouseup = () => {
	const hidden = toggleHighlightsButton.classList.toggle("is-active");
	if (hidden) {
		editorElement.contentWindow.postMessage(JSON.stringify({ method: "hideHighlights" }), "*");
	} else {
		displayHighlights();
	}
};
```

- [ ] **Step 6: Replace the remove-highlight handler (lines 112-123) with the clear-all handler**

Replace with:

```javascript
clearAllButton.onmouseup = () => {
	if (confirm("Clear all notes and highlights?")) {
		editorElement.contentWindow.postMessage(JSON.stringify({ method: "removeAllAnnotations" }), "*");
		resetHighlightButtons();
		toggleNotesButton.classList.remove("is-active");
		toggleHighlightsButton.classList.remove("is-active");
	}
};
```

- [ ] **Step 7: Fix `resetHighlightButtons` and remove the remove-highlight helpers (lines 485-499)**

Read the current `resetHighlightButtons`, `disableRemoveHighlights`, and `displayHighlights` functions. Replace `resetHighlightButtons` so it also clears `is-active`, and delete `disableRemoveHighlights` entirely (no longer referenced). The result for that region:

```javascript
function resetHighlightButtons() {
	highlightButtons.forEach(highlightButton => {
		highlightButton.classList.add("highlight-disabled");
		highlightButton.classList.remove("is-active");
	});
	editorElement.contentWindow.postMessage(JSON.stringify({ method: "disableHighlight" }), "*");
}

function displayHighlights() {
	toggleHighlightsButton.classList.remove("is-active");
	editorElement.contentWindow.postMessage(JSON.stringify({ method: "displayHighlights" }), "*");
}
```

(If the original `resetHighlightButtons`/`displayHighlights` bodies differ, preserve any extra postMessage calls they made other than the removed remove-highlight ones. The `disableHighlight` and `displayHighlights` messages above match the lib's existing handlers.)

- [ ] **Step 8: Search for and remove any remaining `removeHighlightButton` / `remove-highlight-mode` references**

Run: `grep -n "removeHighlightButton\|remove-highlight-mode\|disableRemoveHighlights\|enableRemoveHighlights" apps/plugin/extension/src/ui/bg/ui-editor.js`
Expected: no matches. If any remain, remove those lines (they are dead after this task).

- [ ] **Step 9: Syntax check**

Run: `node --check apps/plugin/extension/src/ui/bg/ui-editor.js`
Expected: no output (valid).

- [ ] **Step 10: Manual verify (clear-all wiring only; full clear works after Task 5)**

Reload extension, open editor. Add a note, toggle notes (icon should show active pill, notes hide/show), toggle highlights, click a highlight color (active pill appears). Click broom → a confirm dialog appears. (Notes won't actually clear until Task 5 adds the lib handler.)

- [ ] **Step 11: Commit**

```bash
git add apps/plugin/extension/src/ui/bg/ui-editor.js
git commit -m "feat(extension): class-based toggles and clear-all button wiring"
```

---

## Task 5: Add `removeAllAnnotations` handler in the vendored editor lib

**Files:**
- Modify: `apps/plugin/extension/lib/single-file-extension-editor.js` (add a handler in the `window.onmessage` chain near line 2747, after the `disableRemoveHighlights` handler)

Reuses the lib's own primitives: note removal = `containerElement.remove()` on every `NOTE_TAGNAME` element; highlight removal = `resetHighlightedElement(el)` on every `.single-file-highlight` element (the same function used by the click-to-remove path at `:3322-3323`).

- [ ] **Step 1: Add the handler**

After the `disableRemoveHighlights` `if` block (the one ending around line 2750), insert:

```javascript
				if (message.method == "removeAllAnnotations") {
					document.querySelectorAll(NOTE_TAGNAME).forEach(noteElement => noteElement.remove());
					document.querySelectorAll("." + HIGHLIGHT_CLASS).forEach(highlightedElement => resetHighlightedElement(highlightedElement));
					onUpdate(false);
				}
```

- [ ] **Step 2: Confirm the symbols used exist in scope**

Run: `grep -n "function resetHighlightedElement\|const HIGHLIGHT_CLASS\|const NOTE_TAGNAME\|function onUpdate" apps/plugin/extension/lib/single-file-extension-editor.js`
Expected: each appears once. `resetHighlightedElement` (~:3963), `HIGHLIGHT_CLASS` (:2683), `NOTE_TAGNAME` (:2672), `onUpdate` defined in the same module scope. All are reachable from the message handler closure.

- [ ] **Step 3: Syntax check**

Run: `node --check apps/plugin/extension/lib/single-file-extension-editor.js`
Expected: no output (valid).

- [ ] **Step 4: Manual verify clear-all end to end**

Reload extension, open editor. Add 2-3 notes of different colors. Highlight some text in 1-2 colors. Click broom → confirm. Expected: every note disappears AND every highlight is removed (text returns to normal). Toolbar highlight buttons reset to disabled, toggles inactive.

- [ ] **Step 5: Commit**

```bash
git add apps/plugin/extension/lib/single-file-extension-editor.js
git commit -m "feat(extension): add removeAllAnnotations handler to editor lib"
```

---

## Task 6: Modernize the sticky note (rounded corners, soft shadow, dark theme)

**Files:**
- Modify: `apps/plugin/extension/src/ui/pages/editor-note-web.css`

Round to 10px, replace the hard shadow with a soft layered one, round header/textarea to match, add a dark-theme block that darkens the note body while keeping the color as an accent.

- [ ] **Step 1: Update `.note` (rounded + soft shadow + thinner border)**

Replace the `.note { ... }` rule (lines 1-15) with:

```css
.note {
    all: initial;
    display: flex;
    flex-direction: column;
    height: 150px;
    width: 150px;
    position: absolute;
    top: 10px;
    left: 10px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 10px;
    z-index: 2147483646;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .12), 0 1px 3px rgba(0, 0, 0, .08);
    min-height: 100px;
    min-width: 100px;
    overflow: hidden;
}
```

- [ ] **Step 2: Round the header and textarea to match**

Replace the `.note textarea { ... }` rule's body to add no radius (textarea fills the body) but update the `.note header` rule and add radius to the blockquote. Replace the `.note header { ... }` rule with:

```css
.note header {
    all: initial;
    min-height: 30px;
    cursor: grab;
    user-select: none;
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
}
```

- [ ] **Step 3: Soften the moving-state shadow**

Replace the `.note-moving { ... }` rule with:

```css
.note-moving {
    opacity: .85;
    box-shadow: 0 10px 24px rgba(0, 0, 0, .22), 0 3px 8px rgba(0, 0, 0, .14);
}
```

- [ ] **Step 4: Add a dark-theme block at the end of the file**

Append:

```css
@media (prefers-color-scheme: dark) {
    .note {
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow: 0 4px 14px rgba(0, 0, 0, .5), 0 1px 3px rgba(0, 0, 0, .4);
    }

    .note textarea {
        background-color: #2b2b2b;
        color: #e6e6e6;
    }

    .note textarea:focus {
        border-color: rgba(255, 255, 255, 0.25);
    }

    .note-red blockquote,
    .note-green blockquote,
    .note-blue blockquote {
        background-color: #2b2b2b;
    }

    .note-red header {
        background-color: #b3373b;
    }

    .note-green header {
        background-color: #2f7d52;
    }

    .note-blue header {
        background-color: #2f6db3;
    }
}
```

This keeps the colored header as the accent and darkens the writing area in dark mode.

- [ ] **Step 5: Manual verify light theme**

Reload extension, open editor. Add notes of all 3 colors. Expected: 10px rounded corners, soft drop shadow (not the old hard offset shadow), colored header band, white-ish writing area. Drag a note → lifted soft shadow.

- [ ] **Step 6: Manual verify dark theme**

Switch OS to dark. Add notes. Expected: dark writing area with light text, dark-toned colored header accent, soft shadow tuned for dark.

- [ ] **Step 7: Commit**

```bash
git add apps/plugin/extension/src/ui/pages/editor-note-web.css
git commit -m "feat(extension): modern rounded sticky notes with soft shadow and dark theme"
```

---

## Task 7: Swap the sticky-note anchor icon to anchor-simple

**Files:**
- Modify: `apps/plugin/extension/lib/single-file-extension-editor.js:2667` (`BUTTON_ANCHOR_URL`)
- Modify: `apps/plugin/extension/src/ui/pages/editor-note-web.css` (`.note-anchor` filter for theme)

Replace the base64-PNG anchor with an inline-SVG data-URI of `anchor-simple.svg`. The note anchor stays an `<img>` (lib code at `:3077,3110` sets `.src`), so a data-URI is the minimal change.

- [ ] **Step 1: Build the data-URI**

The SVG (normalized, black fill so the CSS filter can tint it) is:

```
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#000000" viewBox="0 0 256 256"><path d="M224,112H200a8,8,0,0,0,0,16h15.64A88.15,88.15,0,0,1,136,207.63V95a32,32,0,1,0-16,0V207.63A88.15,88.15,0,0,1,40.36,128H56a8,8,0,0,0,0-16H32a8,8,0,0,0-8,8,104,104,0,0,0,208,0A8,8,0,0,0,224,112ZM112,64a16,16,0,1,1,16,16A16,16,0,0,1,112,64Z"></path></svg>
```

As a URL-encoded data-URI, `BUTTON_ANCHOR_URL` becomes (replace the entire string literal on line 2667):

```javascript
		const BUTTON_ANCHOR_URL = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='16'%20height='16'%20fill='%23000000'%20viewBox='0%200%20256%20256'%3E%3Cpath%20d='M224,112H200a8,8,0,0,0,0,16h15.64A88.15,88.15,0,0,1,136,207.63V95a32,32,0,1,0-16,0V207.63A88.15,88.15,0,0,1,40.36,128H56a8,8,0,0,0,0-16H32a8,8,0,0,0-8,8,104,104,0,0,0,208,0A8,8,0,0,0,224,112ZM112,64a16,16,0,1,1,16,16A16,16,0,0,1,112,64Z'/%3E%3C/svg%3E";
```

- [ ] **Step 2: Syntax check**

Run: `node --check apps/plugin/extension/lib/single-file-extension-editor.js`
Expected: no output (valid).

- [ ] **Step 3: Add a dark-theme filter for the anchor so it reads in dark mode**

In `editor-note-web.css`, inside the existing dark-theme `@media (prefers-color-scheme: dark)` block added in Task 6, add:

```css
    .note .note-anchor {
        filter: invert(1);
    }
```

(The anchor PNG was dark; inverting makes it light against the dark header.)

- [ ] **Step 4: Manual verify**

Reload extension, open editor. Add a note. Expected: the top-left anchor icon is the new anchor-simple glyph (a ship's anchor), visible in both light and dark themes. Click it to toggle anchored state — still works.

- [ ] **Step 5: Commit**

```bash
git add apps/plugin/extension/lib/single-file-extension-editor.js apps/plugin/extension/src/ui/pages/editor-note-web.css
git commit -m "feat(extension): use anchor-simple icon for sticky-note anchor"
```

---

## Task 8: Final cleanup and full-flow verification

**Files:** none edited unless a leftover is found.

- [ ] **Step 1: Confirm no dead references to removed buttons/PNGs remain in editor sources**

Run: `grep -rn "remove-highlight-button\|button_highlighter_delete\|removeHighlightButton" apps/plugin/extension/src apps/plugin/extension/lib`
Expected: no matches in source. (Old PNG files under `resources/` may still exist on disk per spec — that's intentional; we only care there are no live references.)

- [ ] **Step 2: Full flow in light theme**

Reload extension, open editor. Verify in order:
1. Add red/green/blue notes — correct colors, rounded, soft shadow, new anchor.
2. Toggle notes hides/shows; icon shows active state.
3. Highlight in each color; toggle highlights hides/shows.
4. Save page works (downloads/handles as before).
5. Move to Figma works (copies annotated HTML to clipboard per existing feature).
6. Clear all (broom) → confirm → all notes and highlights gone, toolbar resets.

- [ ] **Step 3: Full flow in dark theme**

Switch OS to dark, repeat Step 2. Toolbar and notes both adapt.

- [ ] **Step 4: Final commit if any leftover was fixed (otherwise skip)**

```bash
git add -A
git commit -m "chore(extension): remove dead references after toolbar redesign"
```

---

## Self-Review notes (completed by plan author)

- **Spec coverage:** icons (Task 1-3), 3-color note/highlight (Task 2-3), eye-slash/pencil-slash toggles (Task 2/4), broom clear-all = notes+highlights (Task 4-5), download/figma icons (Task 2), anchor-simple + 10px radius + soft shadow (Task 6-7), toolbar Figma-style + theme (Task 3), notes dark theme (Task 6-7). All spec sections map to a task.
- **Correction vs spec:** the spec said note color classes are "defined in the lib"; they are actually in `editor-note-web.css`. The plan themes notes by editing that CSS (Task 6), not the lib. The only lib edits are `removeAllAnnotations` (Task 5) and the anchor URL (Task 7), as the spec required.
- **Type/name consistency:** `clear-all-button` / `clearAllButton` / `removeAllAnnotations` / `is-active` / `note-color-red|green|blue` used consistently across Tasks 2-5. `resetHighlightedElement`, `HIGHLIGHT_CLASS`, `NOTE_TAGNAME`, `onUpdate` verified to exist in the lib.
- **No automated tests** by design (no harness for iframe UI in a biome-ignored vendored fork); verification is `node --check` + scripted manual steps.
