import type { FigmaTextNodeChange } from "@woofigma/dom-to-figma/internal";
import { loadFontWithFallback } from "./fonts";
import { mapPaints } from "./paint-mapper";

export async function buildText(
  change: FigmaTextNodeChange,
  missingFamilies: Set<string>
): Promise<TextNode> {
  const node = figma.createText();
  const requested: FontName = {
    family: change.fontName?.family ?? "Inter",
    style: change.fontName?.style ?? "Regular",
  };
  const loaded = await loadFontWithFallback(requested, missingFamilies);
  node.fontName = loaded;
  node.characters = change.characters ?? "";
  if (change.fontSize !== undefined) {
    node.fontSize = change.fontSize;
  }
  if (change.lineHeight) {
    node.lineHeight = {
      value: change.lineHeight.value,
      unit: change.lineHeight.units as "PIXELS" | "PERCENT",
    };
  }
  if (change.letterSpacing) {
    node.letterSpacing = {
      value: change.letterSpacing.value,
      unit: change.letterSpacing.units as "PIXELS" | "PERCENT",
    };
  }
  if (change.textAlignHorizontal) {
    node.textAlignHorizontal =
      change.textAlignHorizontal as TextNode["textAlignHorizontal"];
  }
  const fills = mapPaints(change.fillPaints);
  if (fills.length > 0) {
    node.fills = fills;
  }
  return node;
}
