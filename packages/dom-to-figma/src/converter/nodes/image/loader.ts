/**
 * Identifier for the image being loaded. The element is included so loaders
 * can read auxiliary attributes (`crossOrigin`, `referrerPolicy`, etc.) when
 * choosing a fetch strategy, but `src` is the canonical key.
 */
export type ImageRequest = {
  src: string;
  element: HTMLImageElement;
};

/**
 * Bytes returned from the loader along with the actual content type. The
 * package re-encodes to PNG when the type isn't directly supported by Figma's
 * clipboard format.
 */
export type ImageFile = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export type ImageLoader = (request: ImageRequest) => Promise<ImageFile>;

/**
 * Read image bytes for a src. A `data:<mime>;base64,<payload>` URI is decoded
 * directly (no network, no CORS); any other src is fetched. Returns the bytes
 * and the content type.
 */
export async function decodeImageBytes(src: string): Promise<ImageFile> {
  const dataMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (dataMatch) {
    const mimeType = dataMatch[1] || "application/octet-stream";
    const isBase64 = dataMatch[2] === ";base64";
    const payload = dataMatch[3] ?? "";
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes: bytes.buffer, mimeType };
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status}): ${src}`);
  }
  const blob = await response.blob();
  return { bytes: await blob.arrayBuffer(), mimeType: blob.type };
}

/**
 * Result of processing an `ImageFile` for Figma blob registration.
 */
export type ImageBlobInfo = {
  /** SHA-1 of the (possibly re-encoded) bytes — Figma's blob identifier. */
  hash: Array<number>;
  /** Bytes ready for Figma blob registration (PNG/JPEG/GIF). */
  bytes: Array<number>;
};

const FIGMA_SUPPORTED_FORMATS = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
] as const;

const PNG_QUALITY = 1.0;

/**
 * Build an `ImageLoader` that performs a single direct `fetch(src)`. Works
 * for same-origin images and remote images that send permissive CORS headers.
 * Cross-origin images without CORS will throw — consumers that need a proxy
 * chain should inject their own `ImageLoader`.
 */
export function createDirectImageLoader(): ImageLoader {
  return ({ src }) => decodeImageBytes(src);
}

/**
 * Convert raw loader output into Figma-ready blob info: re-encode to PNG when
 * the mime type isn't supported, then SHA-1 hash the final bytes.
 */
export async function processImageFile(
  file: ImageFile
): Promise<ImageBlobInfo> {
  const finalBytes = isFigmaSupportedFormat(file.mimeType)
    ? file.bytes
    : await convertToPng(file);

  const hash = await sha1(finalBytes);
  return {
    hash,
    bytes: Array.from(new Uint8Array(finalBytes)),
  };
}

function isFigmaSupportedFormat(mimeType: string): boolean {
  return FIGMA_SUPPORTED_FORMATS.includes(
    mimeType.toLowerCase() as (typeof FIGMA_SUPPORTED_FORMATS)[number]
  );
}

async function convertToPng(file: ImageFile): Promise<ArrayBuffer> {
  const sourceBlob = new Blob([file.bytes], { type: file.mimeType });
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas for PNG conversion");
    }
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvasToBlob(canvas, "image/png", PNG_QUALITY);
    return await pngBlob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob"));
        }
      },
      type,
      quality
    );
  });
}

async function sha1(buffer: ArrayBuffer): Promise<Array<number>> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(hashBuffer));
}
