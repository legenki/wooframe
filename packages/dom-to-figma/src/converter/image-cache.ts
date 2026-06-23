import { DedupCache } from "./dedup-cache";
import type { ImageBlobInfo, ImageLoader } from "./nodes/image/loader";
import { processImageFile } from "./nodes/image/loader";

export type ImageCache = DedupCache<
  HTMLImageElement | HTMLVideoElement,
  ImageBlobInfo
>;

export function createImageCache(imageLoader: ImageLoader): ImageCache {
  return new DedupCache({
    load: (element) =>
      imageLoader({ src: (element as any).src || (element as any).currentSrc, element }).then(processImageFile),
    toCacheKey: (element) => (element as any).src || (element as any).currentSrc || "video-no-src",
  });
}
