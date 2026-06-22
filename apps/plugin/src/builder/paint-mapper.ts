import type { FigmaPaint } from "@woofigma/dom-to-figma/internal";

// Fallback gradient transform (identity → top-to-bottom), used only when a
// gradient paint carries no transform. The converter normally computes the real
// direction from the CSS angle and sets it on the paint.
const DEFAULT_GRADIENT_TRANSFORM = [
  [1, 0, 0],
  [0, 1, 0],
];

// The converter stores a gradient transform as an object; Figma wants a matrix.
function toFigmaTransform(t: {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}): Transform {
  return [
    [t.m00, t.m01, t.m02],
    [t.m10, t.m11, t.m12],
  ];
}

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
        opacity: p.opacity,
        visible: p.visible,
        blendMode: p.blendMode as BlendMode,
      });
    } else if (p.type === "GRADIENT_LINEAR") {
      out.push({
        type: "GRADIENT_LINEAR",
        gradientTransform: p.transform
          ? toFigmaTransform(p.transform)
          : (DEFAULT_GRADIENT_TRANSFORM as Transform),
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
  if (typeof index !== "number" || index < 0 || index >= ctx.blobs.length) {
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
