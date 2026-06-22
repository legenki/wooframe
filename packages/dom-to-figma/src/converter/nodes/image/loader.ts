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

  const hash = sha1(finalBytes);
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
  const blob = new Blob([file.bytes], { type: file.mimeType });
  try {
    return await decodeViaBitmap(blob);
  } catch {
    // createImageBitmap can't decode SVG (and some other sources); the <img>
    // path rasterizes anything the browser can render. Throws if it also fails.
    return await decodeViaImg(blob);
  }
}

async function decodeViaBitmap(blob: Blob): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas for PNG conversion");
    }
    ctx.drawImage(bitmap, 0, 0);
    return await canvasToPngBytes(canvas);
  } finally {
    bitmap.close();
  }
}

async function decodeViaImg(blob: Blob): Promise<ArrayBuffer> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create canvas for PNG conversion");
    }
    ctx.drawImage(img, 0, 0);
    return await canvasToPngBytes(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return canvasToBlob(canvas, "image/png", PNG_QUALITY).then((b) =>
    b.arrayBuffer()
  );
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

/**
 * Pure-JS SHA-1 (FIPS 180-1). Returns the 20-byte digest as a number array —
 * the same shape the old crypto.subtle path returned. Used instead of
 * crypto.subtle.digest because SubtleCrypto is unavailable in the Figma plugin
 * iframe (not a secure context).
 */
export function sha1Bytes(input: Uint8Array): Array<number> {
  const ml = input.length * 8;
  // Pad: append 0x80, then zeros, then the 64-bit length, to a 512-bit multiple.
  const withOne = input.length + 1;
  const totalLen = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[input.length] = 0x80;
  // 64-bit big-endian length in the last 8 bytes (ml fits in 32 bits here).
  const dv = new DataView(msg.buffer);
  dv.setUint32(totalLen - 4, ml >>> 0, false);
  dv.setUint32(totalLen - 8, Math.floor(ml / 0x1_00_00_00_00), false);

  let h0 = 0x67_45_23_01;
  let h1 = 0xef_cd_ab_89;
  let h2 = 0x98_ba_dc_fe;
  let h3 = 0x10_32_54_76;
  let h4 = 0xc3_d2_e1_f0;

  const w = new Int32Array(80);
  for (let chunk = 0; chunk < totalLen; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = dv.getInt32(chunk + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      // `?? 0` no-ops at runtime (all indices are set) but satisfies
      // noUncheckedIndexedAccess on the typed-array reads.
      const v =
        (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0);
      w[i] = (v << 1) | (v >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a_82_79_99;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6e_d9_eb_a1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f_1b_bc_dc;
      } else {
        f = b ^ c ^ d;
        k = 0xca_62_c1_d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] ?? 0)) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out: Array<number> = [];
  for (const word of [h0, h1, h2, h3, h4]) {
    out.push(
      (word >>> 24) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 8) & 0xff,
      word & 0xff
    );
  }
  return out;
}

function sha1(buffer: ArrayBuffer): Array<number> {
  return sha1Bytes(new Uint8Array(buffer));
}
