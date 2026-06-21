import type { FigmaNodeChange } from "@woofigma/dom-to-figma/internal";
import { beforeEach, describe, expect, it } from "vitest";
import { buildNodes } from "./build-nodes";
import { createFigmaMock } from "./figma-mock";

function base(localID: number, parent: number, type: "FRAME" | "TEXT") {
  return {
    type,
    guid: { sessionID: 0, localID },
    phase: "CREATED",
    name: `n${localID}`,
    visible: true,
    opacity: 1,
    size: { x: 100, y: 40 },
    transform: { m00: 1, m01: 0, m02: 5, m10: 0, m11: 1, m12: 6 },
    parentIndex: { guid: { sessionID: 0, localID: parent }, position: "0" },
  };
}

describe("buildNodes", () => {
  beforeEach(() => {
    (globalThis as { figma?: unknown }).figma = createFigmaMock();
  });

  it("builds a frame with a text child and reports a summary", async () => {
    const changes: Array<FigmaNodeChange> = [
      {
        ...base(3, 0, "FRAME"),
        fillPaints: [
          {
            type: "SOLID",
            color: { r: 1, g: 1, b: 1, a: 1 },
            opacity: 1,
            visible: true,
            blendMode: "NORMAL",
          },
        ],
      } as FigmaNodeChange,
      {
        ...base(4, 3, "TEXT"),
        characters: "Hi",
        fontName: { family: "Inter", style: "Regular" },
      } as FigmaNodeChange,
    ];
    const result = await buildNodes(changes, 0, "My Import");
    expect(result.summary.built).toBe(2);
    expect(result.summary.skipped).toBe(0);
    expect(result.root.type).toBe("FRAME");
    expect(result.root.children).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted on the line above
    expect(result.root.children[0]!.type).toBe("TEXT");
    expect(
      (result.root.children[0] as { characters?: string }).characters
    ).toBe("Hi");
    // position from transform
    expect(result.root.x).toBe(5);
    expect(result.root.y).toBe(6);
  });

  it("clears the default white fill for a transparent frame", async () => {
    // A transparent container (display:flex/grid, no background) converts to an
    // empty fillPaints. figma.createFrame() starts with an opaque white fill, so
    // the builder must overwrite it with [] rather than leave the default.
    const changes: Array<FigmaNodeChange> = [
      { ...base(3, 0, "FRAME"), fillPaints: [] } as FigmaNodeChange,
    ];
    const result = await buildNodes(changes, 0, "My Import");
    expect((result.root as { fills?: unknown }).fills).toEqual([]);
  });

  it("applies per-side stroke weights for a one-sided border", async () => {
    // A tab button with `border-bottom: 2px` converts to independent border
    // weights (top/right/left = 0, bottom = 2). The builder must set the four
    // per-side stroke weights, not the uniform strokeWeight, or Figma draws the
    // stroke on all four sides.
    const changes: Array<FigmaNodeChange> = [
      {
        ...base(3, 0, "FRAME"),
        strokePaints: [
          {
            type: "SOLID",
            color: { r: 0.24, g: 0.52, b: 0.92, a: 1 },
            opacity: 1,
            visible: true,
            blendMode: "NORMAL",
          },
        ],
        strokeWeight: 2,
        borderTopWeight: 0,
        borderRightWeight: 0,
        borderBottomWeight: 2,
        borderLeftWeight: 0,
        borderStrokeWeightsIndependent: true,
      } as FigmaNodeChange,
    ];
    const result = await buildNodes(changes, 0, "My Import");
    const root = result.root as {
      strokeTopWeight?: number;
      strokeRightWeight?: number;
      strokeBottomWeight?: number;
      strokeLeftWeight?: number;
      strokeWeight?: number;
    };
    expect(root.strokeTopWeight).toBe(0);
    expect(root.strokeRightWeight).toBe(0);
    expect(root.strokeBottomWeight).toBe(2);
    expect(root.strokeLeftWeight).toBe(0);
    // The uniform strokeWeight must not be set when sides are independent.
    expect(root.strokeWeight).toBeUndefined();
  });

  it("ignores the converter's reserved DOCUMENT/CANVAS/root-FRAME scaffold", async () => {
    // Shape of a real @woofigma/dom-to-figma document: DOCUMENT(0) -> CANVAS(1) ->
    // ROOT_FRAME(2), then the user's top-level nodes parented at the root frame
    // (localID 2). buildNodes is called with rootParentLocalId = 2.
    const reserved: Array<FigmaNodeChange> = [
      {
        type: "DOCUMENT",
        guid: { sessionID: 0, localID: 0 },
        phase: "CREATED",
        name: "Document",
        visible: true,
        opacity: 1,
      } as FigmaNodeChange,
      {
        type: "CANVAS",
        guid: { sessionID: 0, localID: 1 },
        phase: "CREATED",
        name: "Page 1",
        visible: true,
        opacity: 1,
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: "!" },
      } as FigmaNodeChange,
      {
        type: "FRAME",
        guid: { sessionID: 0, localID: 2 },
        phase: "CREATED",
        name: "Frame",
        visible: true,
        opacity: 1,
        size: { x: 200, y: 80 },
        parentIndex: { guid: { sessionID: 0, localID: 1 }, position: "!" },
      } as FigmaNodeChange,
    ];
    const user: Array<FigmaNodeChange> = [
      { ...base(3, 2, "FRAME") } as FigmaNodeChange,
      {
        ...base(4, 3, "TEXT"),
        characters: "Hi",
        fontName: { family: "Inter", style: "Regular" },
      } as FigmaNodeChange,
    ];
    const result = await buildNodes([...reserved, ...user], 2, "My Import");

    // Only the two user nodes are built; DOCUMENT/CANVAS/root-FRAME are skipped.
    expect(result.summary.built).toBe(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.skipped).toBe(0);
    // Single user root => returned directly (no extra wrapper frame).
    expect(result.root.type).toBe("FRAME");
    expect(result.root.name).toBe("My Import");
    expect(result.root.children).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(result.root.children[0]!.type).toBe("TEXT");
  });
});
