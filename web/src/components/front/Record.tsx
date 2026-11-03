import { useEffect, useRef, type CSSProperties } from "react";
import type { Tape } from "../../lib/types";

/** where the band stands in front of the sleeve: x, y (fraction of the stage), depth, scale */
const SPOTS: [number, number, number, number][] = [
  [0.4, 0.74, 240, 0.9],
  [0.08, 0.7, 180, 0.78],
  [0.7, 0.72, 200, 0.8],
  [-0.2, 0.6, 110, 0.62],
  [0.96, 0.58, 120, 0.6],
  [-0.24, 0.24, 60, 0.46],
];

/**
 * The hero: a real release as an object. The sleeve tilts toward the pointer, the record (its cover as the
 * label) turns half out of it, and SAM's cut-outs of the band stand in front at different depths.
 */
export function Record({ tape, onOpen }: { tape: Tape; onOpen: () => void }) {
  const stage = useRef<HTMLButtonElement>(null);

  // the tilt eases toward the pointer; written straight to CSS variables, no re-render per frame
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = { x: 0.12, y: -0.08 };
    const now = { x: 0, y: 0 };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX / innerWidth - 0.5;
      target.y = e.clientY / innerHeight - 0.5;
    };
    const step = () => {
      now.x += (target.x - now.x) * 0.06;
      now.y += (target.y - now.y) * 0.06;
      stage.current?.style.setProperty("--rx", `${-now.y * 12}deg`);
      stage.current?.style.setProperty("--ry", `${now.x * 18}deg`);
      raf = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const band = tape.photos.map((p, i) => ({ p, i })).filter(({ p }) => p.cutout || p.motion).slice(0, SPOTS.length);
  return (
    <button ref={stage} className="rec" onClick={onOpen} aria-label={`play ${tape.title}`}>
      <span className="rec__world">
        <span className="rec__disc" aria-hidden="true">
          <span className="rec__grooves" />
          {tape.cover && <img className="rec__label" src={tape.cover} alt="" />}
          <span className="rec__hole" />
        </span>
        <span className="rec__sleeve">
          {tape.cover ? <img src={tape.cover} alt="" /> : <span className="rec__blank" />}
          <span className="rec__sheen" aria-hidden="true" />
        </span>
        {band.map(({ p, i }, k) => {
          const [x, y, z, s] = SPOTS[k];
          return (
            <span
              key={`${tape.id}-${i}`}
              className="rec__member"
              style={
                {
                  left: `${x * 100}%`,
                  top: `${y * 100}%`,
                  "--z": `${z}px`,
                  "--s": s,
                  "--d": `${300 + k * 110}ms`,
                  "--bob": `${2.6 + k * 0.37}s`,
                } as CSSProperties
              }
            >
              <img src={p.motion ?? p.cutout ?? ""} alt={p.hero} />
            </span>
          );
        })}
      </span>
      <span className="rec__play" aria-hidden="true">
        <i /> play {tape.catalog}
      </span>
    </button>
  );
}
