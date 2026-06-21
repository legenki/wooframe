import type { FigmaFrameNodeChange } from "@woofigma/dom-to-figma/internal";
import { describe, expect, it } from "vitest";
import { applyAutoLayout } from "./auto-layout";

function frameChange(
  extra: Partial<FigmaFrameNodeChange>
): FigmaFrameNodeChange {
  return {
    type: "FRAME",
    guid: { sessionID: 0, localID: 1 },
    phase: "CREATED",
    name: "f",
    visible: true,
    opacity: 1,
    ...extra,
  } as FigmaFrameNodeChange;
}

describe("applyAutoLayout", () => {
  it("maps vertical stack with spacing and padding", () => {
    const node: Record<string, unknown> = {};
    applyAutoLayout(
      node as never,
      frameChange({
        stackMode: "VERTICAL",
        stackSpacing: 12,
        stackHorizontalPadding: 16,
        stackVerticalPadding: 8,
        stackPaddingRight: 16,
        stackPaddingBottom: 8,
        stackPrimaryAlignItems: "CENTER",
      })
    );
    expect(node.layoutMode).toBe("VERTICAL");
    expect(node.itemSpacing).toBe(12);
    expect(node.paddingLeft).toBe(16);
    expect(node.paddingRight).toBe(16);
    expect(node.paddingTop).toBe(8);
    expect(node.paddingBottom).toBe(8);
    expect(node.primaryAxisAlignItems).toBe("CENTER");
  });

  it("does nothing when stackMode is NONE", () => {
    const node: Record<string, unknown> = {};
    applyAutoLayout(node as never, frameChange({ stackMode: "NONE" }));
    expect(node.layoutMode).toBeUndefined();
  });
});
