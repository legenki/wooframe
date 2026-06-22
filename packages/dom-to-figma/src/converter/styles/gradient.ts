import type { ImageCache } from "../image-cache";
import type {
  FigmaBlob,
  FigmaColor,
  FigmaPaint,
  FigmaTransform,
} from "../types";
import { cssColorToFigmaColor } from "./color";

type GradientStop = {
  color: FigmaColor;
  position: number;
};

/**
 * Parses a gradient stop string and returns a GradientStop object.
 * @param stopString - The string to parse.
 * @param index - The index of the stop.
 * @param totalStops - The total number of stops.
 * @returns A GradientStop object, or null if the string is invalid.
 */
function parseGradientStop(
  stopString: string,
  index: number,
  totalStops: number
): GradientStop | null {
  const parts = stopString.trim().split(/\s+(?=\d+(?:%|px)?\s*$)/);

  if (parts.length === 0) {
    return null;
  }

  const colorString = parts[0];
  let position: number;

  if (parts.length > 1) {
    const positionString = parts[1];
    if (positionString?.endsWith("%")) {
      position = Number.parseFloat(positionString) / 100;
    } else if (positionString?.endsWith("px")) {
      position = index / (totalStops - 1);
    } else if (positionString) {
      position = Number.parseFloat(positionString);
    } else {
      position = index / (totalStops - 1);
    }
  } else {
    position = index / (totalStops - 1);
  }

  position = Math.max(0, Math.min(1, position));

  try {
    const result = cssColorToFigmaColor(colorString ?? "");
    const color: FigmaColor = result
      ? {
          r: result.color.r,
          g: result.color.g,
          b: result.color.b,
          a: result.opacity,
        }
      : { r: 0, g: 0, b: 0, a: 0 };

    return {
      color,
      position,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a linear gradient angle string and returns the angle in degrees.
 * @param angleString - The string to parse.
 * @returns The angle in degrees.
 */
function parseLinearGradientAngle(angleString: string): number {
  const trimmedAngleString = angleString.trim();

  if (trimmedAngleString.includes("to ")) {
    const direction = trimmedAngleString.replace("to ", "").trim();
    switch (direction) {
      case "top":
        return 0;
      case "right":
        return 90;
      case "bottom":
        return 180;
      case "left":
        return 270;
      case "top right":
        return 45;
      case "bottom right":
        return 135;
      case "bottom left":
        return 225;
      case "top left":
        return 315;
      default:
        return 180;
    }
  }

  if (trimmedAngleString.endsWith("deg")) {
    return Number.parseFloat(trimmedAngleString);
  }

  if (trimmedAngleString.endsWith("rad")) {
    return Number.parseFloat(trimmedAngleString) * (180 / Math.PI);
  }

  if (trimmedAngleString.endsWith("turn")) {
    return Number.parseFloat(trimmedAngleString) * 360;
  }

  return 180;
}

/**
 * Calculates the gradient transform for a given angle.
 * @param angleDegrees - The angle in degrees.
 * @returns The gradient transform.
 */
function calculateGradientTransform(angleDegrees: number): FigmaTransform {
  // CSS uses 0deg = up (north), Figma uses 0deg = right (east)
  // Also need to flip Y-axis since Figma Y coordinates increase downward
  const adjustedAngle = (angleDegrees + 90) * (Math.PI / 180);

  const cos = Math.cos(adjustedAngle);
  const sin = Math.sin(adjustedAngle);

  return {
    m00: cos,
    m01: -sin,
    m02: 0.5 * (1 - cos + sin),
    m10: sin,
    m11: cos,
    m12: 0.5 * (1 - sin - cos),
  };
}

/**
 * Parses a linear gradient string and returns a FigmaPaint object.
 * @param cssGradient - The string to parse.
 * @returns A FigmaPaint object, or null if the string is invalid.
 */
function parseLinearGradient(cssGradient: string): FigmaPaint | null {
  const match = /linear-gradient\s*\((.*)\)/.exec(cssGradient);
  if (!match?.[1]) {
    return null;
  }

  const content = match[1].trim();

  const parts = content.split(/,(?![^(]*\))/);

  let angle = 180;
  let colorStops: Array<string> = [];

  if (parts.length > 0 && parts[0]) {
    const firstPart = parts[0].trim();

    const hasAngle =
      firstPart.includes("deg") ||
      firstPart.includes("rad") ||
      firstPart.includes("turn") ||
      firstPart.includes("to ");

    if (hasAngle) {
      angle = parseLinearGradientAngle(firstPart);
      colorStops = parts.slice(1);
    } else {
      colorStops = parts;
    }
  }

  const stops: Array<GradientStop> = [];
  for (let i = 0; i < colorStops.length; i += 1) {
    const stopString = colorStops[i];
    if (!stopString) {
      continue;
    }

    const stop = parseGradientStop(stopString, i, colorStops.length);
    if (stop) {
      stops.push(stop);
    }
  }

  if (stops.length < 2) {
    return null;
  }

  stops.sort((a, b) => a.position - b.position);

  // Handle transparent colors by making them the same as a visible color but with 0 opacity
  const visibleStops = stops.filter((stop) => stop.color.a > 0);
  if (visibleStops.length > 0) {
    const referenceColor = visibleStops[0]?.color ?? { r: 0, g: 0, b: 0, a: 0 };
    for (const stop of stops) {
      if (
        stop.color.a === 0 &&
        stop.color.r === 0 &&
        stop.color.g === 0 &&
        stop.color.b === 0
      ) {
        // This is a transparent color, use the reference color with 0 opacity
        stop.color = {
          r: referenceColor.r,
          g: referenceColor.g,
          b: referenceColor.b,
          a: 0,
        };
      }
    }
  }

  return {
    type: "GRADIENT_LINEAR",
    stops,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    transform: calculateGradientTransform(angle),
  };
}

/**
 * Converts a CSS background string to an array of FigmaPaint objects (gradients only).
 * @param cssBackground - The string to convert.
 * @returns An array of FigmaPaint objects.
 */
export function cssBackgroundToFigmaPaints(
  cssBackground: string
): Array<FigmaPaint> {
  if (!cssBackground || cssBackground === "none") {
    return [];
  }

  const paints: Array<FigmaPaint> = [];

  // Parse linear gradients
  if (cssBackground.includes("linear-gradient")) {
    const gradientPaint = parseLinearGradient(cssBackground);
    if (gradientPaint) {
      paints.push(gradientPaint);
    }
  }

  return paints;
}

const BACKGROUND_URL_PATTERN = /url\(['"]?([^'")]+)['"]?\)/g;

/**
 * Converts the `url(...)` layers of a CSS `background-image` into IMAGE paints.
 * A `background-image` can stack multiple comma-separated layers, so every
 * `url(...)` is emitted as its own paint (gradient layers are handled by
 * `cssBackgroundToFigmaPaints`). Returns an empty array when there are no urls.
 */
export async function cssBackgroundImageToFigmaPaints(
  cssBackground: string,
  imageCache: ImageCache,
  registerBlob: (blob: FigmaBlob) => number
): Promise<Array<FigmaPaint>> {
  if (!cssBackground || cssBackground === "none") {
    return [];
  }

  const paints: Array<FigmaPaint> = [];

  for (const match of cssBackground.matchAll(BACKGROUND_URL_PATTERN)) {
    const url = match[1];
    if (!url) {
      continue;
    }
    try {
      // `imageCache` keys on `element.src`; a bare `Image` is just the carrier
      // for the url (no load needed — the loader reads the src directly).
      const img = new Image();
      img.src = url;
      const { hash, bytes } = await imageCache.get(img);
      const blobIndex = registerBlob({ bytes: Array.from(bytes) });

      paints.push({
        type: "IMAGE",
        opacity: 1.0,
        visible: true,
        blendMode: "NORMAL",
        transform: {
          m00: 1.0,
          m01: 0.0,
          m02: 0.0,
          m10: 0.0,
          m11: 1.0,
          m12: 0.0,
        },
        image: {
          hash,
          dataBlob: blobIndex,
        },
        imageScaleMode: "FILL",
      });
    } catch (error) {
      console.warn("Failed to load background image:", url, error);
    }
  }

  return paints;
}
