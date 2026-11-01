import type { Phase } from "../../lib/useSongbird";

const TICKS = [-52, -34, -16, 2, 20, 38];

/**
 * Two needle gauges. They only come alive while the tape is moving: one for the
 * voice, one for the tape, deliberately a beat apart so they never look like a
 * loop.
 */
export function Gauges({ phase }: { phase: Phase }) {
  const live = phase === "working" || phase === "playing";
  return (
    <div className="gauges" aria-hidden="true">
      {["voice", "tape"].map((label, index) => (
        <div className="gauge" key={label} data-live={live} data-index={index}>
          <svg viewBox="0 0 64 64" className="gauge__dial">
            <circle className="gauge__face" cx="32" cy="32" r="27.5" />
            <path className="gauge__arc" d="M11 45 A26 26 0 0 1 53 45" />
            {TICKS.map((deg) => (
              <line
                key={deg}
                className="gauge__tick"
                x1="32"
                y1="7.5"
                x2="32"
                y2="13"
                transform={`rotate(${deg} 32 32)`}
              />
            ))}
            <line className="gauge__needle" x1="32" y1="34" x2="32" y2="12" />
            <circle className="gauge__pin" cx="32" cy="32" r="3.4" />
          </svg>
          <span className="dymo gauge__label">{label}</span>
        </div>
      ))}
    </div>
  );
}
