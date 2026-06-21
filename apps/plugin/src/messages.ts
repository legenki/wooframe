import type { FigmaNodeChange } from "@woofigma/dom-to-figma/internal";

export type UiToCode =
  | {
      type: "import-nodes";
      nodeChanges: Array<FigmaNodeChange>;
      rootName: string;
      blobs: Array<{ bytes: Array<number> }>;
    }
  | { type: "cancel" };

export type CodeToUi =
  | {
      type: "import-done";
      built: number;
      total: number;
      skipped: number;
      missingFonts: Array<string>;
      warnings: Array<string>;
    }
  | { type: "import-error"; message: string };
