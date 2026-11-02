import { useState, type CSSProperties } from "react";
import { formatTime } from "../lib/copy";
import type { Box, Tape } from "../lib/types";

/** a square crop around the hero box, for when there is no SAM sticker */
export function HeroCrop({ src, box, className = "" }: { src: string; box: Box | null; className?: string }) {
  const [ar, setAr] = useState(1);
  const b: Box = box ?? [0.2, 0.2, 0.8, 0.8];
  const cx = ((b[0] + b[2]) / 2) * ar;
  const cy = (b[1] + b[3]) / 2;
  let s = Math.max((b[2] - b[0]) * ar, b[3] - b[1]) * 1.18;
  s = Math.min(s, ar, 1);
  const left = Math.min(Math.max(cx - s / 2, 0), ar - s);
  const top = Math.min(Math.max(cy - s / 2, 0), 1 - s);
  const style: CSSProperties = {
    height: `${(1 / s) * 100}%`,
    width: `${(ar / s) * 100}%`,
    left: `${(-left / s) * 100}%`,
    top: `${(-top / s) * 100}%`,
  };
  return (
    <span className={`herocrop ${className}`.trim()} aria-hidden="true">
      <img
        src={src}
        alt=""
        style={style}
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth && el.naturalHeight) setAr(el.naturalWidth / el.naturalHeight);
        }}
      />
    </span>
  );
}

// stickers live in the lower two thirds; the top third is left calm for the title
const SPOTS: Array<[number, number, number, number]> = [
  [6, 40, 44, -7],
  [50, 36, 42, 6],
  [24, 54, 48, 3],
  [4, 70, 40, 8],
  [54, 66, 40, -5],
  [30, 80, 36, -2],
];

/**
 * The J-card art. Muse Image paints a portrait with a calm top third; with no
 * cover the deck composes one from the day's stickers on paper, keeping the
 * same calm top third. The title is set over it by CoverTitle.
 */
export function Cover({ tape, className = "" }: { tape: Tape; className?: string }) {
  if (tape.cover) {
    return (
      <div className={`cover cover--art ${className}`.trim()}>
        <img className="cover__art" src={tape.cover} alt={`cover art for ${tape.title}, painted from the day's stickers`} draggable={false} />
      </div>
    );
  }
  return (
    <div className={`cover cover--composed ${className}`.trim()} role="img" aria-label={`cover for ${tape.title}, made from the day's stickers`}>
      <span className="cover__sun" aria-hidden="true" />
      {tape.photos.slice(0, 6).map((p, i) => {
        const [x, y, w, r] = SPOTS[i % SPOTS.length];
        const style = { left: `${x}%`, top: `${y}%`, width: `${w}%`, ["--r" as string]: `${r}deg` } as CSSProperties;
        return p.cutout ? (
          <img key={i} className="cover__sticker" src={p.cutout} alt="" style={style} draggable={false} />
        ) : (
          <span key={i} className="cover__badge" style={style}>
            <HeroCrop src={p.src} box={p.box} />
          </span>
        );
      })}
    </div>
  );
}

/** title over the calm top third of the cover */
export function CoverTitle({ tape, className = "" }: { tape: Tape; className?: string }) {
  return (
    <div className={`covertitle ${className}`.trim()}>
      <span className="covertitle__brand">
        <span>songbird records</span>
        <span>{tape.catalog ?? formatTime(tape.duration)}</span>
      </span>
      <p className="covertitle__artist">{tape.artist ?? tape.dedication}</p>
      <h2 className="covertitle__title">{tape.title}</h2>
      {tape.genre && <p className="covertitle__genre">{tape.genre}</p>}
    </div>
  );
}
