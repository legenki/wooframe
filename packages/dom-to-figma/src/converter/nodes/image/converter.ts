import type { Position } from "../../dom";
import type { ImageCache } from "../../image-cache";
import { parseBorderFromComputedStyle } from "../../styles/border";
import { createSolidPaint, cssColorToFigmaColor } from "../../styles/color";
import {
  cssBackgroundImageToFigmaPaints,
  cssBackgroundToFigmaPaints,
} from "../../styles/gradient";
import { parseOpacity } from "../../styles/opacity";
import { cssBoxShadowToFigmaEffects } from "../../styles/shadow";
import type {
  FigmaBlob,
  FigmaGuid,
  FigmaNodeChange,
  FigmaPaint,
  FigmaRoundedRectangleNodeChange,
} from "../../types";

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
  registerBlob: (blob: FigmaBlob) => number;
  imageCache: ImageCache;
};

export async function elementToImageNodeChange(
  element: HTMLImageElement,
  options: Params
): Promise<FigmaRoundedRectangleNodeChange> {
  const { guid, parentGuid, childIndex, position, registerBlob, imageCache } =
    options;

  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  const boxShadow = computedStyle.boxShadow;
  const effects = cssBoxShadowToFigmaEffects(boxShadow);
  const opacity = parseOpacity(computedStyle.opacity);

  // Parse border information (includes border radius)
  const borderProperties = parseBorderFromComputedStyle(computedStyle, {
    width,
    height,
  });

  const fillPaints: Array<FigmaPaint> = [];

  const backgroundColor = cssColorToFigmaColor(computedStyle.backgroundColor);
  if (backgroundColor) {
    fillPaints.push(
      createSolidPaint(backgroundColor.color, backgroundColor.opacity)
    );
  }

  const backgroundImage = computedStyle.backgroundImage;
  if (backgroundImage && backgroundImage !== "none") {
    const gradientPaints = cssBackgroundToFigmaPaints(backgroundImage);
    const bgImagePaints = await cssBackgroundImageToFigmaPaints(
      backgroundImage,
      imageCache,
      registerBlob
    );
    fillPaints.push(...gradientPaints, ...bgImagePaints);
  }

  const { hash, bytes } = await imageCache.get(element);
  const blobIndex = registerBlob({ bytes: Array.from(bytes) });
  fillPaints.push({
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

  const nodeChange: FigmaNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "ROUNDED_RECTANGLE",
    name: "Image",
    visible: true,
    opacity,

    /* Size and Position */
    size: {
      x: width,
      y: height,
    },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
    },

    /* Stroke and Corner Radius */
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    ...borderProperties,

    /* Fill */
    fillPaints,

    /* Effects */
    effects,

    /* Aspect Ratio */
    targetAspectRatio: {
      value: {
        x: width,
        y: height,
      },
    },
  };

  return nodeChange;
}
