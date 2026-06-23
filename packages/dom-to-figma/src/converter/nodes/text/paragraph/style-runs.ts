import { createSolidPaint, cssColorToFigmaColor } from "../../../styles/color";
import { cssBackgroundsGradientsToFigmaPaintsSync } from "../../../styles/gradient";
import type { FigmaPaint } from "../../../types";
import type { FigmaStyleOverride } from "../../../types/text";
import { buildFontStyleName } from "../primitives/font/loader";
import { parseFontProperties } from "../primitives/font/properties";
import type { AssembledParagraph } from "./assembler";

export type StyleRuns = {
  characterStyleIDs: Array<number>;
  styleOverrideTable: Array<FigmaStyleOverride>;
};

// A stable descriptor of the visual style we care about for a run. Two spans
// with equal descriptors share a styleID.
type StyleDescriptor = {
  family: string;
  weight: number;
  italic: boolean;
  fontSize: number;
  fills: Array<FigmaPaint>;
  fillKey: string;
  textDecoration: "NONE" | "UNDERLINE";
  letterSpacing: number;
};

function fillsFor(style: CSSStyleDeclaration): Array<FigmaPaint> {
  const color = cssColorToFigmaColor(style.color);
  const background = style.backgroundImage || style.background;
  if (background && background !== "none" && color === null) {
    return cssBackgroundsGradientsToFigmaPaintsSync(background);
  }
  if (color) {
    return [createSolidPaint(color.color, color.opacity)];
  }
  return [];
}

function describeStyle(element: Element): StyleDescriptor {
  const style = window.getComputedStyle(element);
  const font = parseFontProperties(
    style.fontFamily,
    style.fontWeight,
    style.fontStyle
  );
  const fills = fillsFor(style);
  return {
    family: font.family,
    weight: font.weight,
    italic: font.italic,
    fontSize: Number.parseFloat(style.fontSize || "16"),
    fills,
    fillKey: JSON.stringify(fills),
    textDecoration:
      (style.textDecorationLine || "none") === "underline"
        ? "UNDERLINE"
        : "NONE",
    letterSpacing:
      style.letterSpacing !== "normal"
        ? Number.parseFloat(style.letterSpacing)
        : 0,
  };
}

function descriptorKey(d: StyleDescriptor): string {
  return `${d.family}|${d.weight}|${d.italic}|${d.fontSize}|${d.fillKey}|${d.textDecoration}|${d.letterSpacing}`;
}

/**
 * Build the per-character style id array and the override table for an
 * assembled paragraph. styleID 0 is the block's base style; any run that
 * differs gets its own deduplicated id and a partial override entry.
 */
export function buildStyleRuns(
  block: Element,
  paragraph: AssembledParagraph
): StyleRuns {
  const baseKey = descriptorKey(describeStyle(block));
  const characterStyleIDs = new Array<number>(paragraph.characters.length).fill(
    0
  );

  const idByKey = new Map<string, number>([[baseKey, 0]]);
  const overrides = new Map<number, FigmaStyleOverride>();
  let nextId = 1;

  for (const span of paragraph.spans) {
    const descriptor = describeStyle(span.element);
    const key = descriptorKey(descriptor);
    if (key === baseKey) {
      continue;
    }
    let id = idByKey.get(key);
    if (id === undefined) {
      id = nextId;
      nextId += 1;
      idByKey.set(key, id);
      overrides.set(id, {
        styleID: id,
        fontName: {
          family: descriptor.family,
          style: buildFontStyleName(descriptor.weight, descriptor.italic),
          // The kiwi FontName struct requires postscript; use empty string to
          // match Figma's own clipboard format for override entries.
          postscript: "",
        },
        fontSize: descriptor.fontSize,
        fillPaints: descriptor.fills,
        ...(descriptor.textDecoration === "UNDERLINE" && {
          textDecoration: "UNDERLINE" as const,
        }),
        ...(descriptor.letterSpacing !== 0 && {
          letterSpacing: { value: descriptor.letterSpacing, units: "PIXELS" },
        }),
      });
    }
    for (let i = span.start; i < span.end; i += 1) {
      characterStyleIDs[i] = id;
    }
  }

  return {
    characterStyleIDs,
    styleOverrideTable: Array.from(overrides.values()),
  };
}
