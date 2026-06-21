import type { FigmaFrameNodeChange } from "@woofigma/dom-to-figma/internal";

export function applyAutoLayout(
  node: FrameNode,
  change: FigmaFrameNodeChange
): void {
  if (!change.stackMode || change.stackMode === "NONE") {
    return;
  }
  node.layoutMode = change.stackMode;
  if (change.stackSpacing !== undefined) {
    node.itemSpacing = change.stackSpacing;
  }
  if (change.stackCounterSpacing !== undefined) {
    node.counterAxisSpacing = change.stackCounterSpacing;
  }
  if (change.stackWrap !== undefined) {
    node.layoutWrap = change.stackWrap as FrameNode["layoutWrap"];
  }
  if (change.stackHorizontalPadding !== undefined) {
    node.paddingLeft = change.stackHorizontalPadding;
  }
  if (change.stackPaddingRight !== undefined) {
    node.paddingRight = change.stackPaddingRight;
  }
  if (change.stackVerticalPadding !== undefined) {
    node.paddingTop = change.stackVerticalPadding;
  }
  if (change.stackPaddingBottom !== undefined) {
    node.paddingBottom = change.stackPaddingBottom;
  }
  if (change.stackPrimarySizing !== undefined) {
    node.primaryAxisSizingMode =
      change.stackPrimarySizing as FrameNode["primaryAxisSizingMode"];
  }
  if (change.stackCounterSizing !== undefined) {
    node.counterAxisSizingMode =
      change.stackCounterSizing as FrameNode["counterAxisSizingMode"];
  }
  if (change.stackPrimaryAlignItems !== undefined) {
    node.primaryAxisAlignItems =
      change.stackPrimaryAlignItems as FrameNode["primaryAxisAlignItems"];
  }
  if (change.stackCounterAlignItems !== undefined) {
    node.counterAxisAlignItems =
      change.stackCounterAlignItems as FrameNode["counterAxisAlignItems"];
  }
}
