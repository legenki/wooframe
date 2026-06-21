import type { FigmaNodeChange } from "@woofigma/dom-to-figma/internal";
import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";

function frame(
  localID: number,
  parent?: number,
  position = "0"
): FigmaNodeChange {
  return {
    type: "FRAME",
    guid: { sessionID: 0, localID },
    phase: "CREATED",
    name: `n${localID}`,
    visible: true,
    opacity: 1,
    ...(parent !== undefined
      ? { parentIndex: { guid: { sessionID: 0, localID: parent }, position } }
      : {}),
  } as FigmaNodeChange;
}

describe("buildTree", () => {
  it("roots at the node whose parent is the reserved root and nests children", () => {
    const changes = [frame(3, 0, "a"), frame(4, 3, "b"), frame(5, 3, "a")];
    const tree = buildTree(changes, 0);
    expect(tree.map((n) => n.change.guid.localID)).toEqual([3]);
    // children of 3 sorted by position "a" < "b" => [5, 4]
    // biome-ignore lint/style/noNonNullAssertion: test assertion — tree[0] is guaranteed by the prior expect
    expect(tree[0]!.children.map((c) => c.change.guid.localID)).toEqual([5, 4]);
  });
});
