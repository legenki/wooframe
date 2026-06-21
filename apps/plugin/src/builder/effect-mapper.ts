import type { FigmaEffect } from "@woofigma/dom-to-figma/internal";

export function mapEffects(
  effects: Array<FigmaEffect> | undefined
): Array<Effect> {
  if (!effects) {
    return [];
  }
  const out: Array<Effect> = [];
  for (const e of effects) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      out.push({
        type: e.type,
        visible: e.visible,
        radius: e.radius,
        color: e.color,
        offset: e.offset,
        blendMode: e.blendMode as BlendMode,
        spread: e.spread ?? 0,
      } as Effect);
    } else if (e.type === "FOREGROUND_BLUR") {
      out.push({
        type: "LAYER_BLUR",
        visible: e.visible,
        radius: e.radius,
      } as Effect);
    } else if (e.type === "BACKGROUND_BLUR") {
      out.push({
        type: "BACKGROUND_BLUR",
        visible: e.visible,
        radius: e.radius,
      } as Effect);
    }
  }
  return out;
}
