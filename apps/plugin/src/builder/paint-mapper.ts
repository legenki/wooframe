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
