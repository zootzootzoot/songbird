import { useEffect, useRef, useState } from "react";
import { asset } from "../../lib/env";

/** one thing from one sample day, rendered by Muse Image from its photo (server/scripts/gen_objects.py) */
export type Floater = { src: string; day: string; label: string; tid?: string; name?: string; genre?: string };

/**
 * Where the things float: x / y are the centre in % of the hero, s the size, d the depth (parallax + blur).
 * The middle band stays clear for the wordmark.
 */
const SLOTS = [
  { x: 9, y: 22, s: 1.05, d: 0.7 },
  { x: 24, y: 10, s: 0.62, d: 0.35 },
  { x: 79, y: 15, s: 0.95, d: 0.6 },
  { x: 93, y: 36, s: 0.72, d: 0.45 },
  { x: 13, y: 56, s: 1.18, d: 0.9 },
  { x: 5, y: 86, s: 1.35, d: 1 },
  { x: 27, y: 84, s: 0.98, d: 0.8 },
  { x: 87, y: 62, s: 1.12, d: 0.85 },
  { x: 72, y: 87, s: 1.3, d: 1 },
  { x: 96, y: 90, s: 0.85, d: 0.7 },
  { x: 64, y: 14, s: 0.55, d: 0.25 },
  { x: 46, y: 85, s: 0.62, d: 0.45 },
  { x: 35, y: 15, s: 0.5, d: 0.2 },
];

export function Floaters({ items, onOpen }: { items: Floater[]; onOpen: (tid: string) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // pointer parallax: one rAF per frame, written as CSS vars so nothing re-renders
  useEffect(() => {
    const el = field.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let tx = 0, ty = 0, x = 0, y = 0;
    const move = (e: PointerEvent) => {
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    };
    const tick = () => {
      x += (tx - x) * 0.06;
      y += (ty - y) * 0.06;
      el.style.setProperty("--mx", x.toFixed(4));
      el.style.setProperty("--my", y.toFixed(4));
      raf = requestAnimationFrame(tick);
    };
    addEventListener("pointermove", move, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fl" ref={field} aria-label="things from other people's days">
      {SLOTS.slice(0, items.length).map((slot, i) => {
        const it = items[i];
        const live = Boolean(it.tid);
        return (
          <button
            key={it.src}
            className="fl__thing"
            data-live={live}
            data-hover={hover === i}
            data-side={slot.x > 50 ? "l" : "r"}
            disabled={!live}
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              ["--s" as string]: slot.s,
              ["--d" as string]: slot.d,
              ["--i" as string]: i,
            }}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => it.tid && onOpen(it.tid)}
            aria-label={live ? `${it.label}, from ${it.name}'s day: play the ${it.genre} single` : it.label}
          >
            <span className="fl__bob">
              <img src={asset(it.src)} alt="" draggable={false} />
            </span>
            {live && (
              <span className="fl__pill" aria-hidden="true">
                <i />
                <b>{it.label}</b>
                <span>
                  {it.name}'s day · {it.genre}
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
