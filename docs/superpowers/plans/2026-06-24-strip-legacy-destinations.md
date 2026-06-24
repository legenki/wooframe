# Strip Legacy SingleFile Destinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused SingleFile cloud/remote destination features (Google Drive, Dropbox, WebDAV, Amazon S3, GitHub, REST/Form API, MCP, Companion/native-messaging, Share, Bookmarks) from the wooFrame extension — in both the `src/` reference sources and the loaded pre-built bundles — so the only save paths are local file download, clipboard (Move to Figma), and open-in-editor, then write a privacy policy that honestly reflects the local-only result.

**Architecture:** The extension is a vendored SingleFile fork with **no build pipeline** — `lib/*.js` are pre-built artifacts loaded directly. Destination dispatch is a clean `if/else if` chain in `downloads.js` keyed on `message.saveToX` flags, mirrored in the minified SW bundle. We remove each destination's: (1) dispatch branch, (2) `saveToX` function, (3) config defaults, (4) options-page UI row + JS wiring, (5) manifest permission — in `src/` AND the bundle. We keep the file-download, `saveToClipboard`, and `openEditor` paths untouched.

**Tech Stack:** Vanilla JS (ES modules + minified IIFE bundles), HTML, Chrome MV3. No test runner covers `extension/` (biome-ignored). Verification = `node --check` per edited JS file + scripted manual smoke tests in the loaded extension.

---

## Critical context for the implementer

**No automated tests, no build step.** Editing `src/` alone does NOT change runtime behavior — the manifest loads pre-built bundles. Every functional change must be applied to BOTH the `src/` file (reference) AND the corresponding loaded bundle. Verify with `node --check <file>` and manual smoke testing.

**Loaded bundles (from manifest + HTML):**
- SW (background): `lib/single-file-extension-background.js` — **contains the live destination dispatch + `saveToX` functions.**
- `lib/single-file-extension.js` — imported via `importScripts(...)` at `src/core/bg/business.js:42` into the SW; also contains destination dispatch refs.
- Content scripts (`single-file-frames.bundle.js`, `single-file-bootstrap.bundle.js`, `single-file-hooks-frames.js`) — **no destination code** (capture engine only). Do NOT touch.
- `lib/single-file.js`, `lib/single-file-extension-editor-helper.js` — only 1 incidental `googleapis` token each (not dispatch). Do NOT touch.

**Keep these save paths working (do NOT remove):**
- Default background file download (`backgroundSave`, `downloadPage`, `downloadContent` core).
- `saveToClipboard` — used by "Move to Figma".
- `openEditor`.

**Destinations to REMOVE** (flag → function):
`saveToGDrive`→`saveToGDrive`, `saveToDropbox`→`saveToDropbox`, `saveWithWebDAV`→`saveWithWebDAV`, `saveToS3`→`saveToS3`, `saveToGitHub`→`saveToGitHub`, `saveToRestFormApi`→`saveToRestFormApi`, `saveWithMCP`→`saveWithMCP`, `saveWithCompanion` (native messaging), `sharePage`, and Bookmarks.

**Established facts (do not re-derive):**
- Dispatch chain: `src/core/bg/downloads.js` `downloadContent()` ~lines 200-260 (the `else if (message.saveToX)` chain).
- `saveToX` function definitions in `downloads.js`: `saveToGitHub:508`, `saveToS3:521`, `saveWithWebDAV:534`, `saveWithMCP:547`, `saveToGDrive:560`, `saveToDropbox:592`, `saveToRestFormApi:667`. Plus `getDropboxAuthInfo:490`.
- Config defaults in `src/core/bg/config.js`: lines 101-118 (`saveToGDrive`…`sharePage`) and 173-181 (`saveToRestFormApi*`, `S3*`), plus `dropboxAuthInfo` helpers (`getDropboxAuthInfo:614`, `setDropboxAuthInfo:622`, `removeDropboxAuthInfo:635`) and their exports (`config.js:244-248`).
- Options UI rows in `src/ui/pages/options.html`: ids `sharePage*` (289), `saveToGitHub*` (298), `saveWithWebDAV*` (318), `saveWithMCP*` (334), `saveToGDrive*` (345), `saveToS3*` (349), `saveToDropbox*` (373), `saveWithCompanion*` (377).
- UI wiring in `src/ui/bg/ui-options.js`: `disableDestinationPermissions(...)` click handlers (~lines 584-592) and `onClickSaveToGDrive`/related handlers.
- Manifest `optional_permissions`: `["identity", "nativeMessaging", "bookmarks"]` — all three become removable.

**Commit discipline:** Commit on `main`, authored as the user only (no Co-Authored-By). Conventional-commit subject, lowercase first word (commitlint enforces `subject-case`).

---

## File Structure

| File | Change |
|------|--------|
| `src/core/bg/downloads.js` | Remove destination dispatch branches + `saveToX` functions + `getDropboxAuthInfo` |
| `lib/single-file-extension-background.js` | Same removal in the minified SW bundle |
| `lib/single-file-extension.js` | Same removal in this importScripts'd bundle |
| `src/core/bg/config.js` | Remove destination default keys + dropboxAuthInfo helpers/exports |
| `src/ui/pages/options.html` | Remove destination option rows |
| `src/ui/bg/ui-options.js` | Remove destination input wiring/handlers |
| `src/core/bg/bookmarks.js`, `src/core/bg/companion.js` | Remove (or neutralize) — bookmarks + native-messaging companion |
| `manifest.json` | Remove `optional_permissions` (identity, nativeMessaging, bookmarks) |
| `docs/legal/privacy-policy.md` | **Create** — local-only privacy policy |

---

## Task 1: Snapshot baseline + smoke-test harness

Establish what "still works" means before removing anything, so regressions are detectable.

**Files:** none modified.

- [ ] **Step 1: Record current loaded bundles and destination footprint**

Run:
```bash
cd apps/plugin/extension
grep -c -iE "saveToGDrive|saveToDropbox|saveWithWebDAV|saveToS3|saveToGitHub|saveToRestFormApi|saveWithMCP|saveWithCompanion" lib/single-file-extension-background.js lib/single-file-extension.js
```
Expected: nonzero counts (baseline). Save these numbers; after removal they must drop to 0 in these two bundles.

- [ ] **Step 2: Load unpacked + baseline smoke test**

Load `apps/plugin/extension` unpacked in `chrome://extensions`. Verify the three KEEP paths work:
1. Open a page → wooFrame editor opens.
2. Save → page downloads as `.html`.
3. Move to Figma → "copied to clipboard" alert; paste into the wooFrame Import Figma plugin yields layers.

Record this as the regression baseline. No commit (no files changed).

---

## Task 2: Remove destination dispatch + functions from downloads.js (source)

**Files:**
- Modify: `src/core/bg/downloads.js`

- [ ] **Step 1: Read the current dispatch chain and function definitions**

Run: `sed -n '196,320p' apps/plugin/extension/src/core/bg/downloads.js` and `sed -n '460,700p' apps/plugin/extension/src/core/bg/downloads.js`
Confirm the `else if (message.saveToX)` chain and the `saveToGitHub/saveToS3/saveWithWebDAV/saveWithMCP/saveToGDrive/saveToDropbox/saveToRestFormApi/getDropboxAuthInfo/getAuthInfo/getDropboxAuthInfo` functions.

- [ ] **Step 2: Simplify the early-return guard**

Find (near line 200):
```javascript
if (message.backgroundSave && !message.saveToGDrive && !message.saveToDropbox && !message.saveWithWebDAV && !message.saveToGitHub && !message.saveToRestFormApi && !message.saveToS3) {
```
Replace with:
```javascript
if (message.backgroundSave) {
```

- [ ] **Step 3: Remove the destination dispatch branches**

In `downloadContent`, delete every `else if (message.saveWithWebDAV) { … }`, `else if (message.saveWithMCP) { … }`, `else if (message.saveToGDrive) { … }`, `else if (message.saveToDropbox) { … }`, `else if (message.saveToGitHub) { … }`, `else if (message.saveWithCompanion) { … }`, `else if (message.saveToRestFormApi) { … }`, and `else if (message.saveToS3) { … }` block. KEEP the `if (message.openEditor)`, `else if (message.saveToClipboard)`, and the final `else` (default file download) branches. Also remove the `if (message.bookmarkId && message.replaceBookmarkURL …)` block that follows the chain.

- [ ] **Step 4: Delete the now-unreferenced destination functions**

Delete these function definitions entirely: `getAuthInfo`, `getDropboxAuthInfo`, `saveToGitHub`, `saveToS3`, `saveWithWebDAV`, `saveWithMCP`, `saveToGDrive`, `saveToDropbox`, `saveToRestFormApi`. KEEP: `encodeSharpCharacter`, `getRegExp`, `testSkipSave`, `promptFilename`, `downloadPage`, `downloadPageForeground`, `downloadTabPage`, `downloadCompressedContent`, `onMessage`, `downloadContent`.

- [ ] **Step 5: Remove deleted names from the module's `export { … }` block**

Open the `export { … }` block (~line 64) and remove any of the deleted function names if present.

- [ ] **Step 6: Syntax check**

Run: `node --check apps/plugin/extension/src/core/bg/downloads.js`
Expected: no output (valid). If it errors about an undefined reference, grep `downloads.js` for the named symbol and remove the remaining caller.

- [ ] **Step 7: Verify no dangling references to removed functions in src**

Run: `grep -rn "saveToGDrive\|saveToDropbox\|saveWithWebDAV\|saveToS3\|saveToGitHub\|saveToRestFormApi\|saveWithMCP\|getDropboxAuthInfo" apps/plugin/extension/src/core/bg/downloads.js`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add apps/plugin/extension/src/core/bg/downloads.js
git commit -m "refactor(extension): remove cloud destination dispatch and functions from downloads source"
```

---

## Task 3: Mirror the downloads.js removal in the loaded bundles

**Files:**
- Modify: `lib/single-file-extension-background.js`
- Modify: `lib/single-file-extension.js`

This is minified-bundle surgery. Work one destination token at a time; re-run `node --check` after each.

- [ ] **Step 1: Locate destination dispatch + functions in the SW bundle**

Run: `grep -n "saveToGDrive\|saveToDropbox\|saveWithWebDAV\|saveToS3\|saveToGitHub\|saveToRestFormApi\|saveWithMCP\|saveWithCompanion" apps/plugin/extension/lib/single-file-extension-background.js`
Read each match's surrounding statement with `sed -n`.

- [ ] **Step 2: Remove the dispatch branches in the SW bundle**

For each `else if(e.saveToGDrive)…` style branch in the minified `downloadContent` equivalent, delete the branch, preserving the `saveToClipboard`/openEditor/default branches and surrounding `if/else` validity. After each deletion run:
```bash
node --check apps/plugin/extension/lib/single-file-extension-background.js
```
Expected: valid after each edit. If invalid, revert that single edit and re-inspect bracket balance.

- [ ] **Step 3: Remove the destination function definitions in the SW bundle**

Delete the minified definitions corresponding to `saveToGitHub`, `saveToS3`, `saveWithWebDAV`, `saveWithMCP`, `saveToGDrive`, `saveToDropbox`, `saveToRestFormApi`, `getDropboxAuthInfo`, `getAuthInfo`. Re-run `node --check` after each.

- [ ] **Step 4: Repeat for single-file-extension.js**

Run: `grep -n "saveToGDrive\|saveToDropbox\|saveWithWebDAV\|saveToS3" apps/plugin/extension/lib/single-file-extension.js`
Remove the dispatch/function refs the same way. Run `node --check apps/plugin/extension/lib/single-file-extension.js` after each.

- [ ] **Step 5: Verify both bundles are clean**

Run:
```bash
grep -c -iE "saveToGDrive|saveToDropbox|saveWithWebDAV|saveToS3|saveToGitHub|saveToRestFormApi|saveWithMCP|saveWithCompanion" apps/plugin/extension/lib/single-file-extension-background.js apps/plugin/extension/lib/single-file-extension.js
```
Expected: `0` for both.

- [ ] **Step 6: Smoke test the KEEP paths in the loaded extension**

Reload the extension. Verify: editor opens, Save downloads `.html`, Move to Figma copies to clipboard and pastes into the Figma plugin. If any break, the bundle edit removed too much — revert and redo more narrowly.

- [ ] **Step 7: Commit**

```bash
git add apps/plugin/extension/lib/single-file-extension-background.js apps/plugin/extension/lib/single-file-extension.js
git commit -m "refactor(extension): remove cloud destination code from loaded bundles"
```

---

## Task 4: Remove destination config defaults

**Files:**
- Modify: `src/core/bg/config.js`

- [ ] **Step 1: Remove the destination default keys**

Delete these lines from the defaults object: `saveToGDrive`, `saveToDropbox`, `saveWithWebDAV`, `webDAVURL`, `webDAVUser`, `webDAVPassword`, `saveWithMCP`, `mcpServerUrl`, `mcpAuthToken`, `saveToGitHub`, `saveToRestFormApi`, `saveToS3`, `githubToken`, `githubUser`, `githubRepository`, `githubBranch`, `saveWithCompanion`, `sharePage` (block at ~101-118), and `saveToRestFormApiUrl`, `saveToRestFormApiFileFieldName`, `saveToRestFormApiUrlFieldName`, `saveToRestFormApiToken`, `S3Domain`, `S3Region`, `S3Bucket`, `S3AccessKey`, `S3SecretKey` (block at ~173-181).

- [ ] **Step 2: Remove the dropboxAuthInfo helpers and exports**

Delete `getDropboxAuthInfo`, `setDropboxAuthInfo`, `removeDropboxAuthInfo` function definitions (~614-640) and their names from the `export { … }` block (~244-248).

- [ ] **Step 3: Syntax check + dangling-ref scan**

Run: `node --check apps/plugin/extension/src/core/bg/config.js`
Run: `grep -n "DropboxAuthInfo\|S3\|webDAV\|saveToGDrive" apps/plugin/extension/src/core/bg/config.js`
Expected: valid; no matches.

- [ ] **Step 4: Mirror in the SW bundle config defaults**

Run: `grep -n "S3Domain\|webDAVURL\|githubRepository\|dropboxAuthInfo" apps/plugin/extension/lib/single-file-extension-background.js`
Remove the corresponding minified default keys + dropboxAuthInfo helpers. `node --check` after.

- [ ] **Step 5: Commit**

```bash
git add apps/plugin/extension/src/core/bg/config.js apps/plugin/extension/lib/single-file-extension-background.js
git commit -m "refactor(extension): drop cloud destination config defaults"
```

---

## Task 5: Remove destination options from the options UI

**Files:**
- Modify: `src/ui/pages/options.html`
- Modify: `src/ui/bg/ui-options.js`

- [ ] **Step 1: Remove the option rows in options.html**

Delete the DOM blocks for these option ids and their enclosing row/container: `sharePageOption`/`sharePageInput`, `saveToGitHubLabel`/`saveToGitHubInput`, `saveWithWebDAVLabel`/`saveWithWebDAVInput`, `saveWithMCPLabel`/`saveWithMCPInput`, `saveToGDriveOption`/`saveToGDriveInput`, `saveToS3Option`/`saveToS3Input`, `saveToDropboxOption`/`saveToDropboxInput`, `saveWithCompanionOption`/`saveWithCompanionInput`. KEEP `saveToFilesystem*` and `saveToClipboard*`.

- [ ] **Step 2: Remove the matching JS wiring in ui-options.js**

Delete the `addEventListener` handlers referencing the removed inputs, including the `disableDestinationPermissions(...)` click handlers for `saveToGDriveInput`, `saveToDropboxInput`, `saveWithWebDAVInput`, `saveWithMCPInput`, `saveToRestFormApiInput`, `sharePageInput`, `saveWithCompanionInput`, plus `onClickSaveToGDrive` and any `getDropboxAuthInfo`/GitHub/S3/WebDAV/MCP-specific handlers and element lookups (`document.querySelector(...)` for those ids). KEEP `saveToFilesystemInput`, `saveToClipboardInput` and their handlers.

- [ ] **Step 3: Syntax check + dangling-ref scan**

Run: `node --check apps/plugin/extension/src/ui/bg/ui-options.js`
Run: `grep -n "saveToGDrive\|saveToDropbox\|saveWithWebDAV\|saveToS3\|saveWithMCP\|saveWithCompanion\|sharePage\|saveToGitHub\|saveToRestFormApi" apps/plugin/extension/src/ui/bg/ui-options.js`
Expected: valid; no matches (or only matches that are clearly unrelated — re-inspect any remaining).

- [ ] **Step 4: Note on the options bundle**

The options page loads `src/ui/bg/ui-options.js` directly (per `options.html`'s `<script>`), so no bundle mirror is needed here. Confirm:
Run: `grep -n "ui-options.js" apps/plugin/extension/src/ui/pages/options.html`
Expected: a direct `src/ui/bg/ui-options.js` reference.

- [ ] **Step 5: Smoke test options page**

Reload extension → open Options. Verify the destination options are gone, the page renders without console errors, and "Save to file" / "Save to clipboard" still toggle.

- [ ] **Step 6: Commit**

```bash
git add apps/plugin/extension/src/ui/pages/options.html apps/plugin/extension/src/ui/bg/ui-options.js
git commit -m "refactor(extension): remove cloud destination options from settings ui"
```

---

## Task 6: Remove bookmarks + companion modules and manifest permissions

**Files:**
- Modify: `manifest.json`
- Modify: `src/core/bg/index.js` (and bundle) — drop bookmarks/companion wiring
- Remove behavior of: `src/core/bg/bookmarks.js`, `src/core/bg/companion.js`

- [ ] **Step 1: Remove optional_permissions from the manifest**

In `apps/plugin/extension/manifest.json`, delete the `optional_permissions` array entirely (`["identity", "nativeMessaging", "bookmarks"]`). Verify no remaining code calls `browser.permissions.request` for those:
Run: `grep -rn "nativeMessaging\|\"bookmarks\"\|identity" apps/plugin/extension/src apps/plugin/extension/manifest.json`
Remove any remaining request sites.

- [ ] **Step 2: Drop bookmarks/companion message handlers**

In `src/core/bg/index.js` (and the SW bundle), remove imports/usages of `bookmarks.js` and `companion.js` message routing. Then either delete `bookmarks.js`/`companion.js` or leave them unimported (unreferenced files don't load). Prefer deleting the source files for cleanliness:
```bash
git rm apps/plugin/extension/src/core/bg/bookmarks.js apps/plugin/extension/src/core/bg/companion.js
```
(Only if `grep -rn "bookmarks\|companion" apps/plugin/extension/src/core/bg/index.js` shows you removed all references first.)

- [ ] **Step 3: Mirror in SW bundle**

Run: `grep -n "nativeMessaging\|bookmarks\|companion" apps/plugin/extension/lib/single-file-extension-background.js`
Remove the corresponding handlers. `node --check` after.

- [ ] **Step 4: Manifest valid + permissions final**

Run: `python3 -c "import json; m=json.load(open('apps/plugin/extension/manifest.json')); print('optional_permissions' in m); print(m['permissions'])"`
Expected: `False` (no optional_permissions); core permissions list unchanged. Note: `identity` was only ever under optional_permissions, so it's gone.

- [ ] **Step 5: Smoke test**

Reload extension. Verify it loads with no manifest errors and the three KEEP paths still work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(extension): drop bookmarks, companion, and unused optional permissions"
```

---

## Task 7: Full regression sweep

**Files:** none unless a leftover is found.

- [ ] **Step 1: Global dangling-reference scan**

Run:
```bash
grep -rniE "saveToGDrive|saveToDropbox|saveWithWebDAV|saveToS3|saveToGitHub|saveToRestFormApi|saveWithMCP|saveWithCompanion|sharePage|getDropboxAuthInfo" apps/plugin/extension/src apps/plugin/extension/lib/single-file-extension-background.js apps/plugin/extension/lib/single-file-extension.js
```
Expected: no matches (ignore matches inside `_locales/*/messages.json` translation strings — those are harmless display labels; optionally clean later).

- [ ] **Step 2: Syntax check every edited JS file**

Run:
```bash
for f in src/core/bg/downloads.js src/core/bg/config.js src/ui/bg/ui-options.js src/core/bg/index.js lib/single-file-extension-background.js lib/single-file-extension.js; do node --check "apps/plugin/extension/$f" && echo "OK $f"; done
```
Expected: `OK` for each.

- [ ] **Step 3: Full manual smoke test (the acceptance gate)**

Reload extension and verify, in light AND dark theme:
1. Editor opens on a real page.
2. Add notes (3 colors), highlight, clear-all — all work.
3. Save → downloads a complete `.html` (images/CSS inlined).
4. Move to Figma → clipboard → paste into wooFrame Import → editable layers.
5. Options page renders; only "Save to file" and "Save to clipboard" destinations remain.
6. Console has no errors referencing removed features.

- [ ] **Step 4: Commit any leftover fix (else skip)**

```bash
git add -A
git commit -m "chore(extension): remove leftover references after destination cleanup"
```

---

## Task 8: Write the privacy policy

**Files:**
- Create: `docs/legal/privacy-policy.md`

Now that cloud destinations are gone, the policy can honestly state local-only processing.

- [ ] **Step 1: Create the privacy policy**

Create `docs/legal/privacy-policy.md` with this content:

```markdown
# wooFrame Snapshot — Privacy Policy

_Last updated: 2026-06-24_

wooFrame Snapshot ("the extension") captures the web page you are viewing and
either saves it as a single HTML file on your device or copies it to your
clipboard so you can paste it into the wooFrame Import plugin for Figma.

## What the extension accesses

- **The content of the page you choose to capture.** When you start a capture,
  the extension reads the current page's HTML, styles, images, and other
  resources in order to build the snapshot. This happens only on pages where
  you explicitly trigger a capture.
- **Basic tab information** (the active tab's URL and title) needed to perform
  the capture and name the saved file.
- **Your settings** (capture options), stored locally in the browser via the
  extension storage API.

## How your data is used

- **All processing happens locally, in your browser.** The captured page is
  assembled on your device.
- The result is delivered only to a destination you choose:
  - a **file download** saved to your computer, or
  - your **clipboard**, for pasting into Figma.
- The extension does **not** send captured pages, browsing data, or personal
  information to wooFrame, its developer, or any third-party server.

## Data sharing and sale

- We do **not** sell or share your data.
- We do **not** use your data for advertising or analytics.

## Permissions

The extension requests only the permissions needed to capture the current page
locally (read the active tab, inject the capture scripts, download files, write
to the clipboard, and store your settings). It does not request access to cloud
accounts or remote storage.

## Network access

To faithfully reproduce a page, the extension may fetch sub-resources that the
page itself references (for example images or stylesheets), from the same
origins the page already loads them from. It does not transmit your captured
content to any wooFrame-operated service.

## Changes

If this policy changes, the updated version will be published at the URL below
with a new "Last updated" date.

## Contact

Questions: open an issue at https://github.com/legenki/wooframe
```

- [ ] **Step 2: Verify it matches reality**

Run: `grep -rniE "googleapis|dropbox|amazonaws|webdav" apps/plugin/extension/lib/single-file-extension-background.js`
Expected: no matches — confirms the "no remote storage" claim is now true. If matches remain, finish Task 3 before publishing the policy.

- [ ] **Step 3: Commit**

```bash
git add docs/legal/privacy-policy.md
git commit -m "docs: add local-only privacy policy"
```

---

## Self-Review notes (completed by plan author)

- **Coverage:** removal of every named destination (GDrive/Dropbox/WebDAV/S3/GitHub/REST/MCP/Companion/Share/Bookmarks) is covered across src (Tasks 2,4,5,6) and bundles (Tasks 3,4,6); privacy policy is Task 8, written to match the local-only end state. KEEP paths (file/clipboard/editor) explicitly preserved and smoke-tested (Tasks 1,3,5,6,7).
- **Bundle reality:** plan reflects that `lib/*.js` are pre-built (no build step), so every functional change is applied to both src and the loaded SW bundle (`single-file-extension-background.js`) + `single-file-extension.js`; content-script bundles are confirmed destination-free and left untouched.
- **Name consistency:** flag/function names (`saveToGDrive`, `saveToDropbox`, `saveWithWebDAV`, `saveToS3`, `saveToGitHub`, `saveToRestFormApi`, `saveWithMCP`, `saveWithCompanion`, `getDropboxAuthInfo`) used identically in every task and in the final grep sweep.
- **No automated tests** by design (biome-ignored vendored fork, iframe/SW UI); verification is `node --check` + scripted manual smoke tests, with Task 1 establishing the baseline and Task 7 the acceptance gate.
- **Risk note:** minified-bundle surgery (Task 3) is the highest-risk step; the plan mitigates with one-token-at-a-time edits, `node --check` after each, and immediate smoke testing of KEEP paths, with explicit revert guidance.
```
