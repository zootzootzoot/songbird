import type { BirdMood } from "../../lib/useSongbird";

/**
 * The bird.
 *
 * Six shapes and a dot: a stout wooden toy, the way a mid-century toymaker or
 * Charley Harper would have cut it. It is the only thing on the deck with a face,
 * and the face is three lines, so the moods have to do their work in the posture:
 * the sleeping head tilts down, waking is a jerk, proud pulls the chin up and
 * puffs the chest.
 */
export function Bird({ mood }: { mood: BirdMood }) {
  return (
    <div className="bird" data-mood={mood}>
      <svg className="bird__art" viewBox="0 0 136 152" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="bird-body-clip">
            <path d="M38 130 C26 108 32 74 56 60 C78 48 102 56 108 80 C114 106 98 132 72 136 C58 138 46 136 38 130 Z" />
          </clipPath>
        </defs>

        <g className="bird__body">
          <path className="bird__tail" d="M16 100 L56 82 L48 130 Z" />
          <path className="bird__blob" d="M38 130 C26 108 32 74 56 60 C78 48 102 56 108 80 C114 106 98 132 72 136 C58 138 46 136 38 130 Z" />
          <g clipPath="url(#bird-body-clip)">
            <circle className="bird__breast" cx="56" cy="106" r="28" />
            <path className="bird__wing" d="M56 78 C82 78 96 92 94 112 C78 114 60 100 56 86 Z" />
            <path className="bird__wing-line" d="M64 92 C74 96 84 102 88 110" />
          </g>
        </g>

        <g className="bird__head">
          <circle className="bird__skull" cx="92" cy="64" r="23" />
          <path className="bird__brow" d="M90 52 q 8 -5 15 -1" />
          <circle className="bird__eye" cx="99" cy="59" r="3.9" />
          <path className="bird__eye-shut" d="M92 61 q 7 -6 14 0" />
          <path className="bird__smile" d="M98 76 q 6 3 11 0" />
          <g className="bird__beak">
            <path d="M112 62 L130 68 L112 75 Z" />
            <path className="bird__beak-crease" d="M114 68 L126 68" />
          </g>
        </g>

        <g className="bird__feet">
          <path d="M64 135 L64 147 M64 147 l -6 3 M64 147 l 6 3" />
          <path d="M86 134 L86 147 M86 147 l -6 3 M86 147 l 6 3" />
        </g>

        <g className="bird__cheep" aria-hidden="true">
          <path d="M126 52 q 7 -4 10 -11" />
          <path d="M130 60 q 8 -2 13 -7" />
        </g>
      </svg>
    </div>
  );
}