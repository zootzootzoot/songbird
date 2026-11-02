import { useState, type CSSProperties } from "react";
import type { Box } from "../lib/types";

export type PrintState = {
  /** the scanner is reading it (muse spark) */
  scanning?: boolean;
  /** what spark called the hero */
  hero?: string | null;
  /** the producer's casting credit */
  role?: string | null;
  /** sam is cutting: a dashed line runs round the frame */
  cutting?: boolean;
  /** sam's sticker */
  cutout?: string | null;
  box?: Box | null;
  /** a moving sticker (animated webp) sam followed through a clip; wins over cutout */
  motion?: string | null;
  motionBox?: Box | null;
  /** the 3 s clip behind a video print; plays while its line is sung */
  clip?: string | null;
  /** the song (or the writer) is on this one */
  forward?: boolean;
  dim?: boolean;
  /** the sticker arrived during this session (animate the peel) */
  fresh?: boolean;
  /** stagger index for label stamping */
  order?: number;
};

/**
 * One photo, printed in a single ocean ink with a paper border. The plate is
 * laid out with object-fit: cover maths so SAM's box (normalised to the photo)
 * lands exactly on the photo, and the sticker can leave the frame as it lifts.
 */
export function Print({
  src,
  index,
  number,
  state = {},
  label,
  className = "",
  video = false,
  still = false,
}: {
  src: string;
  index: number;
  number?: number;
  state?: PrintState;
  label?: string;
  className?: string;
  /** src is a video file (a clip in the tray, before the machine has a still) */
  video?: boolean;
  /** never use the moving sticker (print view) */
  still?: boolean;
}) {
  const [ar, setAr] = useState(1);
  const frame = 1;
  const plate: CSSProperties =
    ar > frame
      ? { height: "100%", width: `${(ar / frame) * 100}%`, left: `${50 - (ar / frame) * 50}%`, top: 0 }
      : { width: "100%", height: `${(frame / ar) * 100}%`, top: `${50 - (frame / ar) * 50}%`, left: 0 };
  const moving = !still && Boolean(state.motion);
  const stickerSrc = moving ? state.motion : state.cutout;
  const box = (moving ? state.motionBox ?? state.box : state.box) ?? null;
  const isClip = video || Boolean(state.clip);
  const playing = Boolean(state.clip) && Boolean(state.forward) && !still;
  const boxStyle: CSSProperties | undefined = box
    ? {
        left: `${box[0] * 100}%`,
        top: `${box[1] * 100}%`,
        width: `${(box[2] - box[0]) * 100}%`,
        height: `${(box[3] - box[1]) * 100}%`,
      }
    : undefined;
  const hasSticker = Boolean(stickerSrc && box);
  const holeBox = state.cutout && state.box ? state.box : null;
  const holeStyle: CSSProperties | undefined = holeBox
    ? {
        left: `${holeBox[0] * 100}%`,
        top: `${holeBox[1] * 100}%`,
        width: `${(holeBox[2] - holeBox[0]) * 100}%`,
        height: `${(holeBox[3] - holeBox[1]) * 100}%`,
        WebkitMaskImage: `url("${state.cutout}")`,
        maskImage: `url("${state.cutout}")`,
      }
    : undefined;
  const span = box ? Math.max(box[2] - box[0], box[3] - box[1]) : 0;
  const cap = span > 0.55 ? 0.55 / span : 1;
  const tilt = [-1.6, 1.1, -0.6, 1.8, -1.2, 0.7][index % 6];
  const lift = index % 2 === 0 ? -1 : 1;

  return (
    <figure
      className={`print ${className}`.trim()}
      data-scanning={Boolean(state.scanning)}
      data-forward={Boolean(state.forward)}
      data-dim={Boolean(state.dim)}
      data-sticker={hasSticker}
      data-clip={isClip}
      data-moving={moving}
      aria-label={label}
      style={
        {
          ["--tilt" as string]: `${tilt}deg`,
          ["--lift" as string]: lift,
          ["--cap" as string]: cap.toFixed(3),
          ["--order" as string]: state.order ?? index,
        } as CSSProperties
      }
    >
      <div className="print__paper">
        <div className="print__frame">
          <div className="print__plate" style={plate}>
            {video ? (
              <video
                className="print__ink"
                src={`${src}#t=0.5`}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  if (el.videoWidth && el.videoHeight) setAr(el.videoWidth / el.videoHeight);
                  try {
                    el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
                  } catch {
                    /* some browsers need a user gesture first */
                  }
                }}
              />
            ) : (
              <img
                className="print__ink"
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) setAr(el.naturalWidth / el.naturalHeight);
                }}
              />
            )}
            {playing && <video className="print__ink print__ink--clip" src={state.clip!} muted playsInline autoPlay loop />}
            {state.scanning &&
              (video ? (
                <video className="print__true" src={`${src}#t=0.5`} muted playsInline preload="metadata" />
              ) : (
                <img className="print__true" src={src} alt="" draggable={false} />
              ))}
            {hasSticker && holeStyle && !playing && <span className="print__hole" data-fresh={Boolean(state.fresh)} style={holeStyle} />}
          </div>
          <span className="print__screen" aria-hidden="true" />
          {state.scanning && <span className="print__beam" aria-hidden="true" />}
          {state.cutting && (
            <svg className="print__cutline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <rect x="7" y="7" width="86" height="86" rx="10" vectorEffect="non-scaling-stroke" pathLength={100} />
            </svg>
          )}
        </div>
        {number !== undefined && <span className="print__no">{String(number).padStart(2, "0")}</span>}
        {isClip && (
          <span className="print__film" aria-hidden="true">
            <svg viewBox="0 0 10 10">
              <path d="M3 2 L8.5 5 L3 8 Z" />
            </svg>
            {moving ? "moving" : "clip"}
          </span>
        )}
      </div>

      {hasSticker && (
        <div className="print__over" aria-hidden="true">
          <div className="print__plate" style={plate}>
            <span className="sticker-anchor" style={boxStyle}>
              <img className="sticker" data-fresh={Boolean(state.fresh)} src={stickerSrc!} alt="" draggable={false} />
            </span>
          </div>
        </div>
      )}

      {state.hero && (
        <figcaption className="print__tag" data-cast={Boolean(state.role)}>
          <span className="print__hero">{state.hero}</span>
          {state.role && (
            <span className="print__role" key={state.role}>
              {state.role}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
