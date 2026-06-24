import type { ImageFile, ImageRequest } from "@wooframe/dom-to-figma";
import {
  createDirectImageLoader,
  createFigmaConverter,
} from "@wooframe/dom-to-figma";
import type { FigmaNodeChange } from "@wooframe/dom-to-figma/internal";
import { computeLoadTimeout } from "./render-timeout";

// Heuristic delay after `load` for bundled pages to finish unpacking into the
// DOM. 400ms covers the exported files tested so far; hydration-heavy pages may
// need more. Future work: replace with a MutationObserver + requestIdleCallback
// settle detector.
const STABILIZE_MS = 400;
// Default render width (Macbook preset). Callers override per screen-size choice.
const DEFAULT_RENDER_WIDTH = 1440;
// Fixed render viewport height. Kept constant (NOT resized to the measured
// content height) so that vh-based styles — e.g. a hero with `height: 100vh` —
// resolve to a normal viewport instead of ballooning to the full page height.
const RENDER_HEIGHT = 1080;

export type RenderResult = {
  nodeChanges: Array<FigmaNodeChange>;
  rootName: string;
  blobs: Array<{ bytes: Array<number> }>;
};

function fetchCorsVideoAsObjectURL(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const msg = event.data.pluginMessage;
      if (msg && msg.type === "FETCH_CORS_RESULT" && msg.url === url) {
        window.removeEventListener("message", handler);
        const blob = new Blob([msg.buffer], { type: "video/mp4" });
        resolve(URL.createObjectURL(blob));
      } else if (msg && msg.type === "FETCH_CORS_ERROR" && msg.url === url) {
        window.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
    };
    window.addEventListener("message", handler);
    parent.postMessage({ pluginMessage: { type: "FETCH_CORS", url } }, "*");
  });
}

const defaultImageLoader = createDirectImageLoader();

const customImageLoader = async (request: ImageRequest): Promise<ImageFile> => {
  const { element, src } = request;
  if (element.tagName.toLowerCase() === "video") {
    const video = element as HTMLVideoElement;
    try {
      if (video.readyState < 2) {
        throw new Error("Video not loaded");
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || video.clientWidth || 300;
      canvas.height = video.videoHeight || video.clientHeight || 150;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png"); // Throws if cross-origin without CORS
        if (dataUrl !== "data:," && dataUrl.length > 100) {
          const res = await fetch(dataUrl);
          const buffer = await res.arrayBuffer();
          return { bytes: buffer, mimeType: "image/png" };
        }
      }
    } catch {
      console.log("CORS error, trying main thread proxy for video:", src);
      try {
        const objectUrl = await fetchCorsVideoAsObjectURL(
          video.currentSrc || video.src || src
        );
        const proxyVideo = document.createElement("video");
        proxyVideo.src = objectUrl;
        proxyVideo.muted = true;
        proxyVideo.playsInline = true;
        proxyVideo.preload = "auto";
        await new Promise((resolve, reject) => {
          proxyVideo.onloadeddata = resolve;
          proxyVideo.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = proxyVideo.videoWidth || video.clientWidth || 300;
        canvas.height = proxyVideo.videoHeight || video.clientHeight || 150;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(proxyVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/png");
          const res = await fetch(dataUrl);
          const buffer = await res.arrayBuffer();
          return { bytes: buffer, mimeType: "image/png" };
        }
      } catch (err) {
        console.warn("Proxy video failed", err);
      }
    }
  }
  return defaultImageLoader(request);
};

function extractBaseUrlFromSingleFile(html: string): string | null {
  const match = html.match(/url:\s*(https?:\/\/[^\s]+)/i);
  return match ? match[1] : null;
}

export async function renderAndConvert(
  html: string,
  rootName: string,
  width: number = DEFAULT_RENDER_WIDTH,
  onProgress?: (message: string, percent: number) => void
): Promise<RenderResult> {
  onProgress?.("Parsing HTML...", 10);
  let finalHtml = html;
  const baseUrl = extractBaseUrlFromSingleFile(html);
  if (baseUrl && !html.includes("<base ")) {
    const baseTag = `<base href="${baseUrl}">`;
    if (finalHtml.includes("<head>")) {
      finalHtml = finalHtml.replace("<head>", `<head>\n  ${baseTag}`);
    } else {
      finalHtml = `${baseTag}\n${finalHtml}`;
    }
  }

  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts", "allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${RENDER_HEIGHT}px;border:0;visibility:hidden`;
  document.body.appendChild(iframe);

  try {
    await writeAndWait(iframe, finalHtml);
    onProgress?.("Loading Media...", 30);
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("Could not access rendered document");
    }
    const body = doc.body;
    const width = Math.max(1, Math.round(doc.documentElement.scrollWidth));
    const height = Math.max(1, Math.round(doc.documentElement.scrollHeight));

    onProgress?.("Converting DOM...", 50);
    const converter = createFigmaConverter({ imageLoader: customImageLoader });
    const result = await converter.convert({
      element: body,
      width,
      height,
      name: rootName,
    });

    onProgress?.("Sending to Figma...", 70);
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
    // We add an extra 3 seconds to the overall timeout to account for media loading
    const timer = setTimeout(
      () => reject(new Error("Render timed out")),
      computeLoadTimeout(html.length) + 3000
    );
    iframe.addEventListener(
      "load",
      async () => {
        // Give bundled-page inline scripts time to unpack into the DOM.
        await new Promise((r) => setTimeout(r, STABILIZE_MS));
        await waitForMedia(iframe.contentDocument);
        clearTimeout(timer);
        resolve();
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

async function waitForMedia(doc: Document | null): Promise<void> {
  if (!doc) {
    return;
  }
  const videos = Array.from(doc.querySelectorAll("video"));
  const images = Array.from(doc.querySelectorAll("img"));

  const promises: Array<Promise<void>> = [];

  for (const video of videos) {
    if (video.readyState >= 2) {
      continue; // HAVE_CURRENT_DATA
    }
    promises.push(
      new Promise<void>((resolve) => {
        const onData = () => {
          video.removeEventListener("loadeddata", onData);
          video.removeEventListener("error", onData);
          resolve();
        };
        video.addEventListener("loadeddata", onData);
        video.addEventListener("error", onData);
      })
    );
    if (video.preload === "none") {
      video.preload = "auto";
    }
  }

  for (const img of images) {
    if (img.complete) {
      continue;
    }
    promises.push(
      new Promise<void>((resolve) => {
        const onData = () => {
          img.removeEventListener("load", onData);
          img.removeEventListener("error", onData);
          resolve();
        };
        img.addEventListener("load", onData);
        img.addEventListener("error", onData);
      })
    );
    if (img.loading === "lazy") {
      img.loading = "eager";
    }
  }

  if (promises.length > 0) {
    // Wait for all media up to 3000ms max
    await Promise.race([
      Promise.all(promises),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
}
