import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";
import { beforeEach, describe, expect, it } from "vitest";
import { createFigmaMock } from "./figma-mock";
import type { PaintContext } from "./paint-mapper";
import { mapPaints } from "./paint-mapper";

beforeEach(() => {
  (globalThis as { figma?: unknown }).figma = createFigmaMock();
});

function ctx(overrides: Partial<PaintContext> = {}): PaintContext {
  return {
    blobs: [{ bytes: [10, 20, 30] }],
    warnings: [],
    nodeName: "Image",
    ...overrides,
  };
}

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

describe("mapPaints", () => {
  it("maps a solid paint and splits alpha into opacity", () => {
    const paints: Array<FigmaPaint> = [
      {
        type: "SOLID",
        color: { r: 1, g: 0, b: 0, a: 0.5 },
        opacity: 1,
        visible: true,
        blendMode: "NORMAL",
      },
    ];
    const out = mapPaints(paints, ctx());
    expect(out).toEqual([
      {
        type: "SOLID",
        color: { r: 1, g: 0, b: 0 },
        opacity: 0.5,
        visible: true,
        blendMode: "NORMAL",
      },
    ]);
  });

  it("maps a linear gradient with stops", () => {
    const paints: Array<FigmaPaint> = [
      {
        type: "GRADIENT_LINEAR",
        stops: [
          { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
        ],
        opacity: 1,
        visible: true,
        blendMode: "NORMAL",
      },
    ];
    const out = mapPaints(paints, ctx());
    expect(out[0]?.type).toBe("GRADIENT_LINEAR");
    expect(
      (out[0] as unknown as { gradientStops: Array<unknown> }).gradientStops
    ).toHaveLength(2);
  });
});

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
});
