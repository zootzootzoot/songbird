import type { Phase } from "../../lib/useSongbird";

/**
 * Three moulded keys. Different travel, different clack: play sits deepest,
 * stop is a quick tap, eject is stiff.
 */
export function Keys({
  phase,
  onPlay,
  onStop,
  onEject,
}: {
  phase: Phase;
  onPlay: () => void;
  onStop: () => void;
  onEject: () => void;
}) {
  const canPlay = phase === "revealed" || phase === "done" || phase === "playing";
  const canStop = phase === "playing";
  const canEject = phase !== "working";

  return (
    <div className="keys" role="group" aria-label="transport keys">
      <button
        type="button"
        className="key key--play"
        onClick={onPlay}
        disabled={!canPlay}
        data-active={phase === "playing"}
      >
        <span className="key__cap">
          <span className="key__glyph key__glyph--play" aria-hidden="true" />
          <span className="dymo key__word">play</span>
        </span>
      </button>
      <button type="button" className="key key--stop" onClick={onStop} disabled={!canStop}>
        <span className="key__cap">
          <span className="key__glyph key__glyph--stop" aria-hidden="true" />
          <span className="dymo key__word">stop</span>
        </span>
      </button>
      <button type="button" className="key key--eject" onClick={onEject} disabled={!canEject}>
        <span className="key__cap">
          <span className="key__glyph key__glyph--eject" aria-hidden="true" />
          <span className="dymo key__word">eject</span>
        </span>
      </button>
    </div>
  );
}