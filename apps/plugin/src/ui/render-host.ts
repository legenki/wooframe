import { createFigmaConverter } from "@woofigma/dom-to-figma";
import type { FigmaNodeChange } from "@woofigma/dom-to-figma/internal";

// Heuristic delay after `load` for bundled pages to finish unpacking into the
// DOM. 400ms covers the exported files tested so far; hydration-heavy pages may
// need more. Future work: replace with a MutationObserver + requestIdleCallback
// settle detector.
const STABILIZE_MS = 400;
const LOAD_TIMEOUT_MS = 10_000;
// Generous viewport so wide/tall pages aren't clipped before measurement.
const RENDER_WIDTH = 1440;
const RENDER_HEIGHT = 4096;

export type RenderResult = {
  nodeChanges: Array<FigmaNodeChange>;
  rootName: string;
};

export async function renderAndConvert(
  html: string,
  rootName: string
): Promise<RenderResult> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${RENDER_WIDTH}px;height:${RENDER_HEIGHT}px;border:0;visibility:hidden`;
  document.body.appendChild(iframe);

  try {
    await writeAndWait(iframe, html);
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("Could not access rendered document");
    }
    const body = doc.body;
    const width = Math.max(1, Math.round(doc.documentElement.scrollWidth));
    const height = Math.max(1, Math.round(doc.documentElement.scrollHeight));

    const converter = createFigmaConverter();
    const result = await converter.convert({
      element: body,
      width,
      height,
      name: rootName,
    });
    return { nodeChanges: result.document.nodeChanges, rootName };
  } finally {
    iframe.remove();
  }
}

function writeAndWait(iframe: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Render timed out")),
      LOAD_TIMEOUT_MS
    );
    iframe.addEventListener(
      "load",
      () => {
        // Give bundled-page inline scripts time to unpack into the DOM.
        setTimeout(() => {
          clearTimeout(timer);
          resolve();
        }, STABILIZE_MS);
      },
      { once: true }
    );
    const doc = iframe.contentDocument;
    if (!doc) {
      clearTimeout(timer);
      reject(new Error("Could not open iframe document"));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}
