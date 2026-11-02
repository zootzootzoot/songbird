/** Client-side photo prep: max 1600px on the long side, JPEG. */

const MAX = 1600;

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> (e.g. some HEIC paths) */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function downscale(blob: Blob, max = MAX, quality = 0.88): Promise<Blob> {
  const img = await decode(blob);
  try {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return out ?? blob;
  } finally {
    img.close();
  }
}

export async function urlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load ${url}`);
  return res.blob();
}

/**
 * Mock-only: fake a SAM cutout so the sticker moment can be exercised without
 * the server. A soft-edged oval of the box region, as a transparent PNG.
 */
export async function fakeCutout(src: string, box: [number, number, number, number]): Promise<string | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const [x1, y1, x2, y2] = box;
    const sw = (x2 - x1) * img.naturalWidth;
    const sh = (y2 - y1) * img.naturalHeight;
    const scale = Math.min(1, 520 / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.beginPath();
    // a lumpy oval so it reads as "cut by hand", not a CSS ellipse
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      const wobble = 1 + Math.sin(a * 3 + 1.3) * 0.035 + Math.sin(a * 5) * 0.02;
      const px = w / 2 + Math.cos(a) * (w / 2 - 2) * wobble * 0.97;
      const py = h / 2 + Math.sin(a) * (h / 2 - 2) * wobble * 0.97;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x1 * img.naturalWidth, y1 * img.naturalHeight, sw, sh, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
