/**
 * The producer. A small wooden bird with enormous opinions, in studio
 * headphones. All of its acting is posture: it leans in to look, cocks its
 * head to think, leaps for the call, nods along to the take, shuts its eyes to
 * listen back, and folds its wings when the record is pressed.
 */
export type ProducerMood = "dozing" | "looking" | "thinking" | "calling" | "nodding" | "listening" | "proud" | "worried";

export function Producer({ mood, beat = 0.6 }: { mood: ProducerMood; beat?: number }) {
  return (
    <div className="producer" data-mood={mood} style={{ ["--beat" as string]: `${beat}s` }} aria-hidden="true">
      <svg viewBox="0 0 160 170" className="producer__art">
        <defs>
          <clipPath id="pb-body">
            <path d="M40 150 C26 124 32 86 60 70 C86 56 116 66 122 94 C128 124 110 152 80 156 C64 158 50 156 40 150 Z" />
          </clipPath>
          <radialGradient id="pb-wood" cx="40%" cy="30%" r="80%">
            <stop offset="0" stopColor="#f7d27a" />
            <stop offset="1" stopColor="#e9a92a" />
          </radialGradient>
        </defs>
        <g className="producer__body">
          <path className="producer__tail" d="M14 116 L60 94 L52 150 Z" />
          <path d="M40 150 C26 124 32 86 60 70 C86 56 116 66 122 94 C128 124 110 152 80 156 C64 158 50 156 40 150 Z" fill="url(#pb-wood)" />
          <g clipPath="url(#pb-body)">
            <circle cx="62" cy="122" r="32" className="producer__breast" />
            <path className="producer__wing" d="M62 92 C92 92 108 108 106 130 C88 132 68 118 62 102 Z" />
            <path d="M70 106 C82 110 94 118 98 126" className="producer__wingline" />
          </g>
        </g>
        <g className="producer__head">
          <circle cx="100" cy="68" r="27" fill="url(#pb-wood)" />
          <g className="producer__eye">
            <circle cx="108" cy="62" r="4.4" className="producer__pupil" />
            <path d="M101 63 q 7 -6 14 0" className="producer__lid" />
          </g>
          <path d="M98 50 q 9 -6 17 -1" className="producer__brow" />
          <g className="producer__beak">
            <path d="M124 64 L146 70 L124 73 Z" className="producer__beak-top" />
            <path d="M124 73 L142 74 L124 80 Z" className="producer__beak-bottom" />
          </g>
          {/* studio headphones */}
          <path d="M74 64 C74 32 126 30 128 60" className="producer__band" />
          <rect x="66" y="56" width="16" height="26" rx="7" className="producer__cup" />
          <rect x="70" y="60" width="8" height="18" rx="4" className="producer__cup-pad" />
        </g>
        <g className="producer__feet">
          <path d="M70 155 L70 166 M70 166 l -7 3 M70 166 l 7 3" />
          <path d="M94 154 L94 166 M94 166 l -7 3 M94 166 l 7 3" />
        </g>
        <g className="producer__marks">
          <path d="M140 40 q 8 -6 10 -14" />
          <path d="M146 52 q 9 -2 14 -9" />
        </g>
      </svg>
      <span className="producer__think">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
