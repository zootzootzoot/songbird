import { memo, useRef } from "react";
import { clock, type Cue } from "./schedule";

/** Minimal overlay transport in the shell's hardware language. Hides while playing. */
export const Transport = memo(function Transport({
  show,
  playing,
  silent,
  time,
  duration,
  cues,
  full,
  copied,
  onToggle,
  onSeek,
  onFull,
  onShare,
  video,
  onExit,
  onReplay,
  volume,
  onVolume,
}: {
  show: boolean;
  playing: boolean;
  silent: boolean;
  time: number;
  duration: number;
  cues: Cue[];
  full: boolean;
  copied: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onFull: () => void;
  onShare: () => void;
  /** the shareable MP4 */
  video: { label: string; busy: boolean; ask: () => void };
  onExit: () => void;
  onReplay?: () => void;
  volume?: number;
  onVolume?: (v: number) => void;
}) {
  const bar = useRef<HTMLDivElement | null>(null);
  const drag = useRef(false);
  const at = (x: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * duration;
  };
  const p = duration ? Math.min(1, time / duration) : 0;
  return (
    <div className="vx" data-show={show ? 1 : 0} onClick={(e) => e.stopPropagation()}>
      <button className="vx-btn vx-exit" onClick={onExit} title="Back to the studio">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span className="label">Studio</span>
      </button>
      <button className="vx-btn vx-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"} title="Space">
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3" width="3" height="10" fill="currentColor" />
            <rect x="9.5" y="3" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="vx-time num">
        <span>{clock(time)}</span>
        <span className="vx-of">{clock(duration)}</span>
      </div>
      <div
        className="vx-scrub"
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (drag.current) onSeek(at(e.clientX));
        }}
        onPointerUp={() => {
          drag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = false;
        }}
      >
        <div className="vx-track">
          {duration > 0 &&
            cues.map((c) => (
              <i
                key={c.index}
                className={c.chorus ? "ch" : ""}
                style={{ left: `${(c.start / duration) * 100}%`, width: `${(Math.max(0.2, c.end - c.start) / duration) * 100}%` }}
              />
            ))}
          <div className="vx-fill" style={{ transform: `scaleX(${p.toFixed(4)})` }} />
          <div className="vx-head" style={{ left: `${(p * 100).toFixed(3)}%` }} />
        </div>
      </div>
      {silent && playing && <span className="vx-silent label">no audio</span>}
      {onVolume && volume != null && (
        <label className="vx-vol" title="Volume">
          <button
            type="button"
            className="vx-vol-icon"
            onClick={() => onVolume(volume > 0 ? 0 : 1)}
            aria-label={volume > 0 ? "Mute" : "Unmute"}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
              {volume > 0 && <path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
              {volume > 0.5 && <path d="M12.8 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.5" />}
              {volume === 0 && <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.5" />}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{ ["--v" as string]: `${volume * 100}%` }}
          />
        </label>
      )}
      <button className="vx-btn vx-video" data-busy={video.busy ? 1 : 0} onClick={video.ask} title="A 9:16 MP4 of this video with the song, for Reels, Stories and chats">
        <span className="label">{video.label}</span>
      </button>
      {onReplay && (
        <button className="vx-btn vx-made" onClick={onReplay} title="Replay this release's real session in the studio">
          <i aria-hidden="true" />
          <span className="label">How it was made</span>
        </button>
      )}
      <button className="vx-btn" onClick={onShare} title="Copy a link to this release">
        <span className="label">{copied ? "Link copied" : "Copy link"}</span>
      </button>
      <button className="vx-btn vx-full" onClick={onFull} aria-label={full ? "Exit fullscreen" : "Fullscreen"} title="F">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {full ? (
            <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          ) : (
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          )}
        </svg>
      </button>
    </div>
  );
});
