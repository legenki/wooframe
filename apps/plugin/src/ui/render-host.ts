import { createFigmaConverter } from "@woofigma/dom-to-figma";
import type { FigmaNodeChange } from "@woofigma/dom-to-figma/internal";
import { computeLoadTimeout } from "./render-timeout";

// Heuristic delay after `load` for bundled pages to finish unpacking into the
// DOM. 400ms covers the exported files tested so far; hydration-heavy pages may
// need more. Future work: replace with a MutationObserver + requestIdleCallback
// settle detector.
const STABILIZE_MS = 400;
// Generous viewport so wide/tall pages aren't clipped before measurement.
// Default render width (Macbook preset). Callers override per screen-size choice.
const DEFAULT_RENDER_WIDTH = 1440;
const RENDER_HEIGHT = 1080;

export type RenderResult = {
  nodeChanges: Array<FigmaNodeChange>;
  rootName: string;
  blobs: Array<{ bytes: Array<number> }>;
};

export async function renderAndConvert(
  html: string,
  rootName: string,
  width: number = DEFAULT_RENDER_WIDTH
): Promise<RenderResult> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${RENDER_HEIGHT}px;border:0;visibility:hidden`;
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

    // Match the iframe viewport to the real content height so position:fixed
    // elements (positioned against view.innerHeight in the converter) land
    // correctly on tall pages, instead of against the initial RENDER_HEIGHT.
    iframe.style.height = `${height}px`;

    const converter = createFigmaConverter();
    const result = await converter.convert({
      element: body,
      width,
      height,
      name: rootName,
    });
    return {
      nodeChanges: result.document.nodeChanges,
      rootName,
      blobs: result.document.blobs,
    };
  } finally {
    iframe.remove();
  }
}

function writeAndWait(iframe: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Render timed out")),
      computeLoadTimeout(html.length)
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
