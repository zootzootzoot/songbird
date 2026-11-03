import { useEffect, useRef } from "react";

/**
 * An image redrawn at sprite resolution and shown with nearest-neighbour scaling, with an optional
 * reduced palette (posterised per channel). Used by the 8-bit theme for the band and the photo flashes.
 */
export function Pixel({
  src,
  rows,
  levels = 0,
  className,
  onAspect,
}: {
  src: string;
  /** vertical resolution in pixels */
  rows: number;
  /** colour levels per channel (0 = untouched) */
  levels?: number;
  className?: string;
  onAspect?: (a: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const cb = useRef(onAspect);
  cb.current = onAspect;

  useEffect(() => {
    let live = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const c = ref.current;
      if (!live || !c || !img.naturalWidth) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      cb.current?.(aspect);
      const h = rows;
      const w = Math.max(1, Math.round(rows * aspect));
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: levels > 0 });
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(img, 0, 0, w, h);
      if (levels > 0) {
        try {
          const data = ctx.getImageData(0, 0, w, h);
          const d = data.data;
          const step = 255 / (levels - 1);
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.round(d[i] / step) * step;
            d[i + 1] = Math.round(d[i + 1] / step) * step;
            d[i + 2] = Math.round(d[i + 2] / step) * step;
            // hard alpha edge, like a sprite
            d[i + 3] = d[i + 3] > 110 ? 255 : 0;
          }
          ctx.putImageData(data, 0, 0);
        } catch {
          /* tainted canvas: keep the smooth downscale */
        }
      }
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src, rows, levels]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
