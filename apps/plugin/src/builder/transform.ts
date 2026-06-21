import type { FigmaTransform } from "@woofigma/dom-to-figma/internal";

export type Decomposed = {
  x: number;
  y: number;
  rotation: number;
  warning?: string;
};

const SHEAR_EPSILON = 1e-4;

export function decomposeTransform(t: FigmaTransform | undefined): Decomposed {
  if (!t) {
    return { x: 0, y: 0, rotation: 0 };
  }
  const rotation = Math.atan2(t.m10, t.m00) * (180 / Math.PI);
  // A pure rotation+scale has orthogonal column vectors (dot product ~ 0).
  const shear = Math.abs(t.m00 * t.m01 + t.m10 * t.m11);
  const warning =
    shear > SHEAR_EPSILON
      ? "shear/skew is not supported in V1 and was ignored"
      : undefined;
  return { x: t.m02, y: t.m12, rotation, warning };
}
