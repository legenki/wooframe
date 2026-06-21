import type {
  FigmaFrameNodeChange,
  FigmaNodeChange,
  FigmaTextNodeChange,
} from "@woofigma/dom-to-figma/internal";
import { applyAutoLayout } from "./auto-layout";
import { mapEffects } from "./effect-mapper";
import { mapPaints } from "./paint-mapper";
import { buildText } from "./text-builder";
import { decomposeTransform } from "./transform";
import type { TreeNode } from "./tree";
import { buildTree } from "./tree";

export type BuildSummary = {
  built: number;
  total: number;
  skipped: number;
  missingFonts: Array<string>;
  warnings: Array<string>;
};

export type BuildResult = {
  root: SceneNode & { children: ReadonlyArray<SceneNode> };
  summary: BuildSummary;
};

export async function buildNodes(
  changes: Array<FigmaNodeChange>,
  rootParentLocalId: number,
  rootName: string
): Promise<BuildResult> {
  const tree = buildTree(changes, rootParentLocalId);
  const missingFonts = new Set<string>();
  const warnings: Array<string> = [];
  let built = 0;
  let skipped = 0;

  async function makeNode(treeNode: TreeNode): Promise<SceneNode | null> {
    const change = treeNode.change;
    try {
      let node: SceneNode;
      if (change.type === "TEXT") {
        node = await buildText(change as FigmaTextNodeChange, missingFonts);
      } else {
        node = figma.createFrame();
        applyFrame(node as FrameNode, change);
      }
      node.name = change.name;
      applyGeometry(node, change, warnings);
      built += 1;
      for (const child of treeNode.children) {
        const childNode = await makeNode(child);
        if (childNode) {
          (node as FrameNode).appendChild(childNode);
        }
      }
      return node;
    } catch (error) {
      skipped += 1;
      warnings.push(`skipped ${change.name}: ${(error as Error).message}`);
      return null;
    }
  }

  let root: SceneNode | null;
  if (tree.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: tree.length === 1 guarantees element exists
    root = await makeNode(tree[0]!);
    if (root) {
      root.name = rootName;
    }
  } else {
    const container = figma.createFrame();
    container.name = rootName;
    for (const r of tree) {
      const n = await makeNode(r);
      if (n) {
        container.appendChild(n);
      }
    }
    root = container;
  }
  if (!root) {
    throw new Error("No nodes could be built from the converted document");
  }

  return {
    root: root as BuildResult["root"],
    summary: {
      built,
      // Total is the number of buildable nodes in the tree (the converter's
      // reserved DOCUMENT/CANVAS/root-FRAME scaffold is excluded by buildTree),
      // so built + skipped accounts for every node we attempted.
      total: countTreeNodes(tree),
      skipped,
      missingFonts: [...missingFonts],
      warnings,
    },
  };
}

function countTreeNodes(tree: Array<TreeNode>): number {
  let count = 0;
  for (const node of tree) {
    count += 1 + countTreeNodes(node.children);
  }
  return count;
}

function applyGeometry(
  node: SceneNode,
  change: FigmaNodeChange,
  warnings: Array<string>
): void {
  const { x, y, warning } = decomposeTransform(change.transform);
  if (warning) {
    warnings.push(`${change.name}: ${warning}`);
  }
  if (change.size && "resize" in node) {
    (node as FrameNode).resize(change.size.x || 0.01, change.size.y || 0.01);
  }
  node.x = x;
  node.y = y;
  node.visible = change.visible ?? true;
  if (change.opacity !== undefined && "opacity" in node) {
    (node as FrameNode).opacity = change.opacity;
  }
}

function applyFrame(node: FrameNode, change: FigmaNodeChange): void {
  const frame = change as FigmaFrameNodeChange;
  // Always assign, even when empty: figma.createFrame() ships with a default
  // opaque white fill, so a transparent container (empty fillPaints) must clear
  // it rather than inherit the default white.
  node.fills = mapPaints(frame.fillPaints);
  const strokes = mapPaints(frame.strokePaints);
  if (strokes.length > 0) {
    node.strokes = strokes;
  }
  applyStrokeWeights(node, frame);
  const effects = mapEffects(frame.effects);
  if (effects.length > 0) {
    node.effects = effects;
  }
  if (frame.cornerRadius !== undefined) {
    node.cornerRadius = frame.cornerRadius;
  }
  applyAutoLayout(node, frame);
}

// CSS borders can differ per side (e.g. `border-bottom: 2px` only). The
// converter flags that with `borderStrokeWeightsIndependent` and the four
// per-side weights. Figma draws a uniform `strokeWeight` on all four sides, so
// when sides are independent we set the per-side weights instead — a 0 weight
// means no stroke on that side. Setting `strokeWeight` afterward would collapse
// them back to uniform, so the two paths are mutually exclusive.
function applyStrokeWeights(
  node: FrameNode,
  frame: FigmaFrameNodeChange
): void {
  if (frame.borderStrokeWeightsIndependent) {
    node.strokeTopWeight = frame.borderTopWeight ?? 0;
    node.strokeRightWeight = frame.borderRightWeight ?? 0;
    node.strokeBottomWeight = frame.borderBottomWeight ?? 0;
    node.strokeLeftWeight = frame.borderLeftWeight ?? 0;
    return;
  }
  if (frame.strokeWeight !== undefined) {
    node.strokeWeight = frame.strokeWeight;
  }
}
