import { buildNodes } from "./builder/build-nodes";
import { ROOT_PARENT_LOCAL_ID } from "./constants";
import type { CodeToUi, UiToCode } from "./messages";

figma.showUI(__html__, { width: 420, height: 560 });

figma.ui.onmessage = async (msg: UiToCode) => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type !== "import-nodes") {
    return;
  }

  try {
    const { root, summary } = await buildNodes(
      msg.nodeChanges,
      ROOT_PARENT_LOCAL_ID,
      msg.rootName,
      msg.blobs
    );
    figma.currentPage.appendChild(root);
    figma.viewport.scrollAndZoomIntoView([root]);
    const done: CodeToUi = {
      type: "import-done",
      built: summary.built,
      total: summary.total,
      skipped: summary.skipped,
      missingFonts: summary.missingFonts,
      warnings: summary.warnings,
    };
    figma.ui.postMessage(done);
  } catch (error) {
    const err: CodeToUi = {
      type: "import-error",
      message: (error as Error).message,
    };
    figma.ui.postMessage(err);
  }
};
