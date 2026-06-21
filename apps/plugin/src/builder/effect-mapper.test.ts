import type { FigmaEffect } from "@woofigma/dom-to-figma/internal";
import { describe, expect, it } from "vitest";
import { mapEffects } from "./effect-mapper";

describe("mapEffects", () => {
  it("maps a drop shadow", () => {
    const effects: Array<FigmaEffect> = [
      {
        type: "DROP_SHADOW",
        visible: true,
        radius: 8,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 2 },
        blendMode: "NORMAL",
        spread: 0,
      },
    ];
    const out = mapEffects(effects);
    expect(out).toEqual([
      {
        type: "DROP_SHADOW",
        visible: true,
        radius: 8,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 2 },
        blendMode: "NORMAL",
        spread: 0,
      },
    ]);
  });

  it("maps a foreground blur to LAYER_BLUR", () => {
    const effects = [
      { type: "FOREGROUND_BLUR", visible: true, radius: 4 },
    ] as Array<FigmaEffect>;
    expect(mapEffects(effects)).toEqual([
      { type: "LAYER_BLUR", visible: true, radius: 4 },
    ]);
  });
});
