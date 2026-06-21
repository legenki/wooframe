import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";
import { describe, expect, it } from "vitest";
import { mapPaints } from "./paint-mapper";

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
    const out = mapPaints(paints);
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

  it("drops IMAGE paints in V1", () => {
    const paints = [
      {
        type: "IMAGE",
        image: { hash: [] },
        opacity: 1,
        visible: true,
        blendMode: "NORMAL",
      },
    ] as Array<FigmaPaint>;
    expect(mapPaints(paints)).toEqual([]);
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
    const out = mapPaints(paints);
    expect(out[0]?.type).toBe("GRADIENT_LINEAR");
    expect(
      (out[0] as unknown as { gradientStops: Array<unknown> }).gradientStops
    ).toHaveLength(2);
  });
});
