# Editor Toolbar & Sticky-Note Redesign

**Date:** 2026-06-24
**Scope:** Annotation editor of the vendored SingleFile fork (`apps/plugin/extension`)

## Goal

Polish the bottom annotation toolbar and the sticky notes it creates:

- Replace the PNG button icons with inline Phosphor SVG icons.
- Replace the point-and-click "remove highlight" button with a single **Clear all** button that removes all notes **and** highlights.
- Modernize the sticky note created on "add note": rounded corners, soft shadow, new anchor icon.
- Make the toolbar look closer to Figma's bottom panel and follow the system light/dark theme — for both the toolbar **and** the sticky notes.

## Affected files

| File | Role |
|------|------|
| `apps/plugin/extension/src/ui/pages/editor.html` | Toolbar markup (buttons) |
| `apps/plugin/extension/src/ui/pages/editor.css` | Toolbar styles + theme |
| `apps/plugin/extension/src/ui/bg/ui-editor.js` | Toolbar button logic |
| `apps/plugin/extension/src/ui/pages/editor-note-web.css` | Sticky-note styles + theme |
| `apps/plugin/extension/lib/single-file-extension-editor.js` | **Vendored** editor iframe: note creation, anchor icon, new `removeAllAnnotations` method, note color theming |
| `apps/plugin/extension/src/ui/resources/icons/*.svg` | New inline Phosphor SVG assets |

The vendored lib edit is approved: it is the only reliable way to clear notes+highlights (iframe is sandboxed, note content lives in shadow DOM) and to swap the anchor icon.

## Icons (Phosphor)

Source SVGs are inlined into `editor.html` as `<svg>` and colored via CSS (`fill: currentColor`, or a fixed per-button `color` for the 3-color icons). Stored under `src/ui/resources/icons/`.

| Button | Icon | Color |
|--------|------|-------|
| Add note ×3 | `sticker.svg` | whole icon red / green / blue |
| Toggle notes (hide/show) | `eye-slash.svg` | theme/neutral |
| Highlight ×3 | `pencil-simple.svg` | whole icon red / green / blue |
| Toggle highlights (display/hide) | `pencil-simple-slash.svg` | theme/neutral |
| Clear all | `broom.svg` | theme/neutral |
| Save page | `download-simple.svg` | theme/neutral |
| Move to Figma | `figma-logo.svg` | theme/neutral |
| Note anchor (inside sticker) | `anchor-simple.svg` | theme/neutral |

The 3-color icons (note + highlight) keep their color in all states (rest/hover/theme). Neutral icons follow the toolbar theme color.

## Toolbar layout

Three groups separated by thin dividers, left → right:

1. **Notes:** add red, add green, add blue, toggle-notes (`eye-slash`)
2. **Highlights:** highlight red, highlight green, highlight blue, toggle-highlights (`pencil-simple-slash`)
3. **Actions:** clear-all (`broom`), save (`download-simple`), move-to-figma (`figma-logo`)

Buttons become `<button type="button" class="tb-btn ...">` wrapping an inline `<svg>` (replacing `<img type="button">`). The existing JS selectors (`.add-note-red-button`, `.highlight-button`, `.toggle-notes-button`, etc.) are preserved as classes so the rest of `ui-editor.js` keeps working; only the removed/added buttons change.

## Clear all (replaces remove-highlight)

### Vendored lib (`single-file-extension-editor.js`)

Add a message handler for a new method `removeAllAnnotations` that:

- removes every sticky note (its host/container element + shadow), reusing the existing per-note removal path used by the note's own remove (`.note-remove`) button, in a loop over all notes;
- removes every highlight wrapper, reusing the existing single-highlight removal logic (the same unwrap used by `enableRemoveHighlights` on click), applied to all highlights at once — not the click-to-remove mode.

Implementation detail (note storage array, highlight unwrap helper) is resolved against the actual lib code during implementation; reuse existing mechanisms rather than inventing new ones.

### `ui-editor.js`

- Remove `removeHighlightButton` and all related code: `remove-highlight-mode` class handling, `disableRemoveHighlights()`, `enableRemoveHighlights` postMessage, and the `remove-highlight-mode` branches inside the highlight-button handlers.
- Add `clearAllButton` (broom): on click, show a `confirm("Clear all notes and highlights?")`; if confirmed, postMessage `{ method: "removeAllAnnotations" }` to the iframe and reset toolbar UI state (clear all `highlight-disabled`, reset toggle-notes / toggle-highlights icons to their visible/default state).

### `editor.html`

Broom button replaces the remove-highlight button in group 3.

## Modern sticky note

`editor-note-web.css`:

- `.note` → `border-radius: 10px`; soft layered shadow `box-shadow: 0 4px 12px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.08)` (replacing the hard `3px 3px 3px`); thinner border; `textarea`/`header` rounded to match.
- `.note-moving` → stronger soft "lifted" shadow.

Anchor icon: replace the `BUTTON_ANCHOR_URL` base64 PNG constant in the lib with a data-URI of `anchor-simple.svg` (minimal one-line change). The icon is recolored for theme via CSS filter on `.note-anchor`.

## Theming (toolbar + notes)

Driven by `@media (prefers-color-scheme: dark)` (the editor already sets `<meta name="color-scheme" content="light dark">`).

**Toolbar (`editor.css`)** — Figma-like, less glassy:
- Panel: neutral surface (light `#ffffff`/`#f5f5f5`, dark `#2c2c2c`), thin border, soft shadow, `border-radius: 10px`, slightly tighter padding/gap.
- Buttons: `currentColor` icons, neutral at rest, hover = subtle background pill (Figma style), active highlight/toggle = highlighted state. The 3-color note/highlight icons keep their fixed color in both themes.
- Thinner dividers.

**Notes (`editor-note-web.css` + lib color rules)** — dark variants under `@media (prefers-color-scheme: dark)`:
- `.note` background → dark (`~#2b2b2b`) while keeping the note-red/green/blue color as a border/header accent (not a full acid fill); `textarea` text color → light; borders/shadows tuned for dark.
- Note color classes (`note-red`/`note-blue`/`note-green`) are defined in the lib; add dark-theme variants there so the color reads as an accent.

## Out of scope / non-goals

- No changes to highlight/note creation behavior beyond what's listed.
- Old PNG resources are left on disk (unreferenced); only the HTML/lib references change.
- No new dependency; Phosphor SVGs are vendored as static assets.

## Testing / verification

Manual verification in the loaded extension editor:
1. Each of the 3 note colors adds a sticker of that color; sticker has 10px rounded corners, soft shadow, new anchor icon.
2. Toggle-notes hides/shows notes; toggle-highlights hides/shows highlights; icons reflect state.
3. Highlight in each of 3 colors works.
4. **Clear all** removes every note and every highlight after confirm; toolbar state resets.
5. Save page and Move to Figma still work.
6. Switch OS theme light↔dark: toolbar and stickers both adapt.
