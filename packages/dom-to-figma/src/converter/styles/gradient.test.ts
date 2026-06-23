import { describe, expect, it } from "vitest";
import { cssBackgroundsGradientsToFigmaPaintsSync } from "./gradient";

describe("cssBackgroundsGradientsToFigmaPaintsSync", () => {
  it("returns [] for none/empty", () => {
    expect(cssBackgroundsGradientsToFigmaPaintsSync("none")).toEqual([]);
    expect(cssBackgroundsGradientsToFigmaPaintsSync("")).toEqual([]);
  });

  it("parses a single linear gradient", () => {
    const paints = cssBackgroundsGradientsToFigmaPaintsSync(
      "linear-gradient(to right, red, blue)"
    );
    expect(paints).toHaveLength(1);
    expect(paints[0]?.type).toBe("GRADIENT_LINEAR");
  });

  it("does not split on commas inside rgba()", () => {
    // One gradient with two rgba() stops — the inner commas must not split it
    // into bogus layers, so exactly one gradient paint comes out.
    const paints = cssBackgroundsGradientsToFigmaPaintsSync(
      "linear-gradient(to right, rgba(0,0,0,1), rgba(255,255,255,0.5))"
    );
    expect(paints).toHaveLength(1);
    expect(paints[0]?.type).toBe("GRADIENT_LINEAR");
  });

  it("reverses layer order so CSS-first becomes Figma-topmost", () => {
    // CSS: first layer is topmost. Figma fillPaints: last is topmost. So a
    // url() between two gradients leaves [gradB, gradA] after reverse (the
    // image layer is dropped by the gradients-only sync path).
    const paints = cssBackgroundsGradientsToFigmaPaintsSync(
      "linear-gradient(0deg, red, blue), url('x.png'), linear-gradient(90deg, lime, black)"
    );
    expect(paints).toHaveLength(2);
    expect(paints.every((p) => p.type === "GRADIENT_LINEAR")).toBe(true);
    // After reverse, the second CSS gradient (90deg, transform m00≈-1) comes
    // first, the first CSS gradient (0deg, m00≈0) last — i.e. topmost in Figma.
    const m00 = paints.map((p) => p.transform?.m00 ?? Number.NaN);
    expect(m00[0]).toBeCloseTo(-1, 2);
    expect(m00[1]).toBeCloseTo(0, 2);
  });
});
