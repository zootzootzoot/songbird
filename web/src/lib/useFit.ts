import { useLayoutEffect, useRef, useState } from "react";

/**
 * Scale a fixed-size drawing (designed at `width` px) to fit its container.
 * Returns a ref for the container and the scale factor.
 */
export function useFit<T extends HTMLElement>(width: number, max = 1.25) {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(max, el.clientWidth / width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, max]);
  return { ref, scale };
}
