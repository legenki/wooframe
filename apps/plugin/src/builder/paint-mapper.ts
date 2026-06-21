import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";

// Figma's GradientPaint requires a gradientTransform; a top-to-bottom default
// is used for V1. Deriving the real direction from the CSS angle is future work.
const DEFAULT_GRADIENT_TRANSFORM = [
  [1, 0, 0],
  [0, 1, 0],
];

export function mapPaints(paints: Array<FigmaPaint> | undefined): Array<Paint> {
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
    }
    // IMAGE: skipped in V1.
  }
  return out;
}
