# Raster image fills in the plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real Figma images for `<img>` elements in the plugin via `figma.createImage`, threading the converter's image blobs through to the builder.

**Architecture:** The converter already emits `ROUNDED_RECTANGLE` nodes with IMAGE fill paints plus PNG bytes in `result.document.blobs` (referenced by `image.dataBlob` index). The plugin surfaces those blobs from `render-host` → `app.tsx` message → `code.ts` → `buildNodes`, and `paint-mapper` gains an IMAGE branch that validates the index, calls `figma.createImage`, and emits an `{type:'IMAGE', imageHash, scaleMode:'FILL'}` fill. `createImage` is synchronous, so no async ripple. The converter is not modified.

**Tech Stack:** TypeScript, Vitest (node `unit` project), Figma Plugin API typings. `FigmaBlob.bytes` is `Array<number>`, so bytes are wrapped in `new Uint8Array(...)` before `createImage`.

---

## File Structure

- **Modify** `packages/dom-to-figma/src/internal.ts` — also export `FigmaBlob` (the plugin needs to type blobs).
- **Modify** `apps/plugin/src/builder/figma-mock.ts` — add a `createImage` stub that can be made to throw.
- **Modify** `apps/plugin/src/builder/paint-mapper.ts` — `mapPaints` takes a `PaintContext`; add the IMAGE branch with index validation + warnings.
- **Modify** `apps/plugin/src/builder/build-nodes.ts` — thread `blobs` into `buildNodes` → `applyFrame` → `mapPaints` (build the context with `change.name`).
- **Modify** `apps/plugin/src/messages.ts` — add `blobs` to the `import-nodes` message.
- **Modify** `apps/plugin/src/ui/render-host.ts` — return `blobs` in `RenderResult`.
- **Modify** `apps/plugin/src/ui/app.tsx` — pass `blobs` into the posted message.
- **Modify** `apps/plugin/src/code.ts` — pass `msg.blobs` to `buildNodes`.
- **Docs**: README limitation note (final task).

Order: types/mock first (Tasks 1–2), then the paint-mapper logic with tests (Task 3), then thread the data through (Task 4), then the e2e build test (Task 5), then docs (Task 6).

---

## Task 1: Export FigmaBlob from the converter's internal surface

**Files:**
- Modify: `packages/dom-to-figma/src/internal.ts`

- [ ] **Step 1: Add FigmaBlob to the exported types**

In `packages/dom-to-figma/src/internal.ts`, add `FigmaBlob` to the `export type { … } from "./converter/types"` block (alphabetical, before `FigmaEffect`):

```ts
export type {
  FigmaBlob,
  FigmaEffect,
  FigmaFrameNodeChange,
  FigmaNodeChange,
  FigmaPaint,
  FigmaTextNodeChange,
  FigmaTransform,
} from "./converter/types";
```

- [ ] **Step 2: Confirm FigmaBlob is reachable from converter/types**

`packages/dom-to-figma/src/converter/types/index.ts` does `export * from "./core"`,
and `FigmaBlob` lives in `./core`, so it is already re-exported — no edit needed
there. The Task 1 typecheck (next step) confirms the `internal.ts` re-export
resolves.

- [ ] **Step 3: Typecheck the converter**

Run: `pnpm --filter @woofigma/dom-to-figma check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dom-to-figma/src/internal.ts
git commit -m "feat(dom-to-figma): export FigmaBlob from internal surface"
```

---

## Task 2: Add a throwable createImage to the figma mock

**Files:**
- Modify: `apps/plugin/src/builder/figma-mock.ts`

- [ ] **Step 1: Add createImage to the mock**

In `apps/plugin/src/builder/figma-mock.ts`, inside the object returned by `createFigmaMock`, add a `createImage` that returns a stub image and throws when the bytes start with a sentinel `0xFF` (lets a test force the error path):

```ts
    createImage: (data: Uint8Array) => {
      // Tests force the error path by passing bytes that start with 0xFF.
      if (data[0] === 0xff) {
        throw new Error("invalid image data");
      }
      return { hash: "img-hash" };
    },
```

- [ ] **Step 2: Typecheck the plugin**

Run: `pnpm --filter plugin check-types`
Expected: PASS (the mock is loosely typed; no callers yet).

- [ ] **Step 3: Commit**

```bash
git add apps/plugin/src/builder/figma-mock.ts
git commit -m "test(plugin): add throwable createImage to figma mock"
```

---

## Task 3: IMAGE branch in paint-mapper with validation and warnings

**Files:**
- Modify: `apps/plugin/src/builder/paint-mapper.ts`
- Test: `apps/plugin/src/builder/paint-mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `apps/plugin/src/builder/paint-mapper.test.ts` with (the file currently tests `mapPaints(paints)`; the signature changes to take a context):

```ts
import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";
import { beforeEach, describe, expect, it } from "vitest";
import { createFigmaMock } from "./figma-mock";
import { mapPaints, type PaintContext } from "./paint-mapper";

beforeEach(() => {
  (globalThis as { figma?: unknown }).figma = createFigmaMock();
});

function imagePaint(dataBlob: number | undefined): FigmaPaint {
  return {
    type: "IMAGE",
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    image: { hash: [1, 2, 3], dataBlob },
    imageScaleMode: "FILL",
  } as FigmaPaint;
}

function ctx(overrides: Partial<PaintContext> = {}): PaintContext {
  return {
    blobs: [{ bytes: [10, 20, 30] }],
    warnings: [],
    nodeName: "Image",
    ...overrides,
  };
}

describe("mapPaints IMAGE handling", () => {
  it("creates an image fill from a valid blob index", () => {
    const context = ctx();
    const out = mapPaints([imagePaint(0)], context);
    expect(out).toEqual([
      { type: "IMAGE", imageHash: "img-hash", scaleMode: "FILL" },
    ]);
    expect(context.warnings).toHaveLength(0);
  });

  it("skips the fill and warns when createImage throws", () => {
    // 0xff sentinel makes the mock throw.
    const context = ctx({ blobs: [{ bytes: [0xff, 0, 0] }] });
    const out = mapPaints([imagePaint(0)], context);
    expect(out).toEqual([]);
    expect(context.warnings).toHaveLength(1);
    expect(context.warnings[0]).toContain("Image");
  });

  it("skips the fill and warns on an out-of-range blob index", () => {
    const context = ctx();
    const out = mapPaints([imagePaint(5)], context);
    expect(out).toEqual([]);
    expect(context.warnings[0]).toContain("5");
  });

  it("skips the fill and warns when dataBlob is missing", () => {
    const context = ctx();
    const out = mapPaints([imagePaint(undefined)], context);
    expect(out).toEqual([]);
    expect(context.warnings).toHaveLength(1);
  });

  it("still maps a SOLID paint with the new signature", () => {
    const solid: FigmaPaint = {
      type: "SOLID",
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    };
    const out = mapPaints([solid], ctx());
    expect(out[0]).toMatchObject({ type: "SOLID" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter plugin exec vitest run paint-mapper.test.ts`
Expected: FAIL — `mapPaints` doesn't accept a context / `PaintContext` not exported.

- [ ] **Step 3: Rewrite paint-mapper.ts**

Replace `apps/plugin/src/builder/paint-mapper.ts` with:

```ts
import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";

// Figma's GradientPaint requires a gradientTransform; a top-to-bottom default
// is used for V1. Deriving the real direction from the CSS angle is future work.
const DEFAULT_GRADIENT_TRANSFORM = [
  [1, 0, 0],
  [0, 1, 0],
];

export type PaintContext = {
  blobs: Array<{ bytes: Array<number> }>;
  warnings: Array<string>;
  nodeName: string;
};

export function mapPaints(
  paints: Array<FigmaPaint> | undefined,
  ctx: PaintContext
): Array<Paint> {
  if (!paints) {
    return [];
  }
  const out: Array<Paint> = [];
  for (const p of paints) {
    if (p.type === "SOLID") {
      out.push({
        type: "SOLID",
        color: { r: p.color.r, g: p.color.g, b: p.color.b },
        opacity: p.color.a,
        visible: p.visible,
        blendMode: p.blendMode as BlendMode,
      });
    } else if (p.type === "GRADIENT_LINEAR") {
      out.push({
        type: "GRADIENT_LINEAR",
        gradientTransform: DEFAULT_GRADIENT_TRANSFORM as Transform,
        gradientStops: p.stops.map((s) => ({
          position: s.position,
          color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        })),
        opacity: p.opacity,
        visible: p.visible,
        blendMode: p.blendMode as BlendMode,
      });
    } else if (p.type === "IMAGE") {
      const fill = mapImagePaint(p, ctx);
      if (fill) {
        out.push(fill);
      }
    }
  }
  return out;
}

// figma.createImage accepts PNG, JPEG, and GIF. The converter always emits PNG
// (it normalizes internally), so that's what we handle here. JPEG would work
// unchanged; WebP is not supported by createImage.
function mapImagePaint(
  paint: Extract<FigmaPaint, { type: "IMAGE" }>,
  ctx: PaintContext
): Paint | null {
  const index = paint.image.dataBlob;
  if (
    typeof index !== "number" ||
    index < 0 ||
    index >= ctx.blobs.length
  ) {
    ctx.warnings.push(
      `"${ctx.nodeName}": image fill skipped (bad blob index ${index} of ${ctx.blobs.length})`
    );
    return null;
  }
  try {
    const bytes = new Uint8Array(ctx.blobs[index]?.bytes ?? []);
    const image = figma.createImage(bytes);
    return { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" };
  } catch (error) {
    ctx.warnings.push(
      `"${ctx.nodeName}": image fill skipped (${(error as Error).message}, blob ${index})`
    );
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter plugin exec vitest run paint-mapper.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format + typecheck**

Run: `pnpm exec biome check --write apps/plugin/src/builder/paint-mapper.ts apps/plugin/src/builder/paint-mapper.test.ts && pnpm --filter plugin check-types`
Expected: build-nodes.ts will fail typecheck (it still calls `mapPaints` with one arg) — that's fixed in Task 4. paint-mapper.ts itself is clean.

- [ ] **Step 6: Commit**

```bash
git add apps/plugin/src/builder/paint-mapper.ts apps/plugin/src/builder/paint-mapper.test.ts
git commit -m "feat(plugin): map IMAGE paints to figma.createImage fills"
```

---

## Task 4: Thread blobs through the build path

**Files:**
- Modify: `apps/plugin/src/builder/build-nodes.ts`
- Modify: `apps/plugin/src/messages.ts`
- Modify: `apps/plugin/src/ui/render-host.ts`
- Modify: `apps/plugin/src/ui/app.tsx`
- Modify: `apps/plugin/src/code.ts`

- [ ] **Step 1: Add `blobs` param to buildNodes and build the paint context**

In `apps/plugin/src/builder/build-nodes.ts`:

Change the `buildNodes` signature and pass `blobs` down. Replace the signature:

```ts
export async function buildNodes(
  changes: Array<FigmaNodeChange>,
  rootParentLocalId: number,
  rootName: string,
  blobs: Array<{ bytes: Array<number> }> = []
): Promise<BuildResult> {
```

In `makeNode`, the `applyFrame` call needs `blobs` + `warnings`. Replace the
non-text branch:

```ts
      } else {
        node = figma.createFrame();
        applyFrame(node as FrameNode, change, blobs, warnings);
      }
```

Replace `applyFrame` to build the context and pass it to `mapPaints`:

```ts
function applyFrame(
  node: FrameNode,
  change: FigmaNodeChange,
  blobs: Array<{ bytes: Array<number> }>,
  warnings: Array<string>
): void {
  const frame = change as FigmaFrameNodeChange;
  const ctx = { blobs, warnings, nodeName: change.name };
  // Always assign, even when empty: figma.createFrame() ships with a default
  // opaque white fill, so a transparent container (empty fillPaints) must clear
  // it rather than inherit the default white.
  node.fills = mapPaints(frame.fillPaints, ctx);
  const strokes = mapPaints(frame.strokePaints, ctx);
  if (strokes.length > 0) {
    node.strokes = strokes;
  }
  applyStrokeWeights(node, frame);
  const effects = mapEffects(frame.effects);
  if (effects.length > 0) {
    node.effects = effects;
  }
  if (frame.cornerRadius !== undefined) {
    node.cornerRadius = frame.cornerRadius;
  }
  applyAutoLayout(node, frame);
}
```

- [ ] **Step 2: Add `blobs` to the import-nodes message**

In `apps/plugin/src/messages.ts`, add `blobs` to the `import-nodes` variant:

```ts
export type UiToCode =
  | {
      type: "import-nodes";
      nodeChanges: Array<FigmaNodeChange>;
      rootName: string;
      blobs: Array<{ bytes: Array<number> }>;
    }
  | { type: "cancel" };
```

- [ ] **Step 3: Surface blobs from render-host**

In `apps/plugin/src/ui/render-host.ts`, add `blobs` to `RenderResult` and return it.

Change the type:

```ts
export type RenderResult = {
  nodeChanges: Array<FigmaNodeChange>;
  rootName: string;
  blobs: Array<{ bytes: Array<number> }>;
};
```

Change the return at the end of `renderAndConvert`:

```ts
    return {
      nodeChanges: result.document.nodeChanges,
      rootName,
      blobs: result.document.blobs,
    };
```

- [ ] **Step 4: Pass blobs from app.tsx into the message**

In `apps/plugin/src/ui/app.tsx`, update the destructure + post (around lines 62–63):

```ts
      const { nodeChanges, rootName, blobs } = await renderAndConvert(
        source,
        name
      );
      post({ type: "import-nodes", nodeChanges, rootName, blobs });
```

- [ ] **Step 5: Pass blobs from code.ts into buildNodes**

In `apps/plugin/src/code.ts`, update the `buildNodes` call:

```ts
    const { root, summary } = await buildNodes(
      msg.nodeChanges,
      ROOT_PARENT_LOCAL_ID,
      msg.rootName,
      msg.blobs
    );
```

- [ ] **Step 6: Update existing build-nodes tests for the new applyFrame path**

The existing `build-nodes.test.ts` calls `buildNodes(changes, 0, "My Import")` —
the new `blobs` param defaults to `[]`, so those calls still compile and pass.
No edit needed unless typecheck complains.

- [ ] **Step 7: Typecheck + run full plugin suite**

Run: `pnpm --filter plugin check-types && pnpm --filter plugin exec vitest run`
Expected: PASS (all prior tests + the 5 new paint-mapper tests).

- [ ] **Step 8: Commit**

```bash
git add apps/plugin/src/builder/build-nodes.ts apps/plugin/src/messages.ts apps/plugin/src/ui/render-host.ts apps/plugin/src/ui/app.tsx apps/plugin/src/code.ts
git commit -m "feat(plugin): thread image blobs from render to builder"
```

---

## Task 5: End-to-end build test for an image node

**Files:**
- Modify: `apps/plugin/src/builder/build-nodes.test.ts`

- [ ] **Step 1: Add the e2e test**

Append this test inside the existing `describe("buildNodes", …)` in
`apps/plugin/src/builder/build-nodes.test.ts`:

```ts
  it("builds an image node with an IMAGE fill from a blob", async () => {
    const changes: Array<FigmaNodeChange> = [
      {
        ...base(3, 0, "FRAME"),
        type: "ROUNDED_RECTANGLE",
        fillPaints: [
          {
            type: "IMAGE",
            opacity: 1,
            visible: true,
            blendMode: "NORMAL",
            image: { hash: [1, 2, 3], dataBlob: 0 },
            imageScaleMode: "FILL",
          },
        ],
      } as FigmaNodeChange,
    ];
    const result = await buildNodes(changes, 0, "My Import", [
      { bytes: [10, 20, 30] },
    ]);
    expect(result.summary.built).toBe(1);
    const fills = (result.root as { fills?: Array<{ type: string }> }).fills;
    expect(fills?.[0]).toMatchObject({
      type: "IMAGE",
      imageHash: "img-hash",
      scaleMode: "FILL",
    });
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter plugin exec vitest run build-nodes.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole plugin suite + build**

Run: `pnpm --filter plugin exec vitest run && pnpm --filter plugin build`
Expected: all tests pass; build produces `dist/code.js` + `dist/index.html`.

- [ ] **Step 4: Commit**

```bash
git add apps/plugin/src/builder/build-nodes.test.ts
git commit -m "test(plugin): e2e build of an image node with IMAGE fill"
```

---

## Task 6: Update the README limitation note

**Files:**
- Modify: `README.md`
- Modify: `apps/plugin/README.md`

- [ ] **Step 1: Update the root README**

In `README.md`, the "Open edges" list currently has item 1 as raster images. Move
it into the resolved list. Replace:

```markdown
Open edges, roughly by increasing effort:

1. **Raster image fills in the plugin** — wire `figma.createImage` so bitmap
   fills land as real images on the canvas.

Earlier limitations now resolved:
```

with:

```markdown
All the originally-listed limitations are now resolved:
```

And add this bullet to the resolved list (after the web-safe fonts bullet):

```markdown
- **Raster image fills** — `<img>` elements build real Figma images via
  `figma.createImage`; the converter's PNG blobs are threaded through to the
  plugin builder. A failed image keeps its frame and records a warning.
```

- [ ] **Step 2: Update the plugin README "Scope (V1)" / limitations**

In `apps/plugin/README.md`, find the "Not yet handled: images (`createImage`), …"
sentence in the Scope section and remove the `images (createImage)` clause:

Replace:

```markdown
Not yet handled: images (`createImage`), per-character icon-font glyph
coverage, and deriving gradient direction from the CSS angle.
```

with:

```markdown
Images build via `figma.createImage` (PNG; a failed image keeps its frame and
records a warning). Not yet handled: per-character icon-font glyph coverage, and
deriving gradient direction from the CSS angle.
```

- [ ] **Step 3: Verify no stale "createImage" TODO remains**

Run: `grep -rn "createImage" README.md apps/plugin/README.md`
Expected: only mentions that describe it as done, none framing it as unhandled.

- [ ] **Step 4: Commit**

```bash
git add README.md apps/plugin/README.md
git commit -m "docs: note raster image fills are supported"
```

---

## Self-Review

- **Spec coverage:** data flow (Tasks 1,4) ✓; node type Frame+IMAGE (Task 4 `applyFrame` unchanged node creation) ✓; per-paint error handling + index validation + warning format (Task 3) ✓; PaintContext with `nodeName` (Task 3) ✓; format comment (Task 3) ✓; mock throwable createImage (Task 2) ✓; all four test cases (Task 3 cases 1-4 + Task 5 e2e) ✓; converter untouched except the `FigmaBlob` re-export (Task 1, additive type-only) ✓; README (Task 6) ✓.
- **Placeholders:** none — all code is concrete.
- **Type consistency:** `PaintContext` (`blobs: Array<{bytes: Array<number>}>`, `warnings`, `nodeName`) is identical across Tasks 3 and 4. `mapPaints(paints, ctx)` signature matches in both. `blobs` typed `Array<{ bytes: Array<number> }>` consistently (FigmaBlob.bytes is Array<number>, wrapped in Uint8Array only at the createImage call). `createImage` returns `{ hash }` in mock and is read as `image.hash` in paint-mapper.
- **Note:** `FigmaBlob.bytes` is `Array<number>`, not `Uint8Array` — the plan wraps it via `new Uint8Array(...)` exactly once, at the `createImage` call site. This was verified against `converter/types/core.ts`.
