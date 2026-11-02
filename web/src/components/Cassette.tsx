import type { CSSProperties } from "react";

/** A cassette hub: white six-tooth sprocket inside a wound pack of tape. */
function Reel({ pack }: { pack: number }) {
  // pack: 0..1 how much tape is wound on this reel
  const r = 19 + pack * 33;
  return (
    <svg className="reel" viewBox="-60 -60 120 120" aria-hidden="true">
      <circle className="reel__pack" r={r} />
      <circle className="reel__pack-sheen" r={r} />
      <g className="reel__hub">
        <circle r="19" className="reel__flange" />
        <circle r="11" className="reel__core" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x="-2.4" y="-12.5" width="4.8" height="6" rx="1" transform={`rotate(${a})`} className="reel__tooth" />
        ))}
        <circle r="3" className="reel__axle" />
      </g>
    </svg>
  );
}

/**
 * The cassette, 380 x 242 (a C60 is 100.4 x 63.8 mm). Cream shell, sunflower
 * label you can write on, a window onto the reels whose tape packs are the
 * counter. When the song is done the label carries the title in ballpoint.
 */
export function Cassette({
  name,
  setName,
  editable,
  title,
  spinning,
  fast,
  wound,
  generation,
  ejecting,
}: {
  name: string;
  setName: (v: string) => void;
  editable: boolean;
  title: string | null;
  spinning: boolean;
  fast: boolean;
  wound: number;
  generation: number;
  ejecting: boolean;
}) {
  const w = Math.min(1, Math.max(0, wound));
  return (
    <div
      className="cassette"
      key={generation}
      data-spinning={spinning}
      data-fast={fast}
      data-ejecting={ejecting}
      style={{ ["--wound" as string]: w } as CSSProperties}
    >
      <div className="cassette__shell">
        <span className="cassette__screw" style={{ left: 9, top: 9 }} />
        <span className="cassette__screw" style={{ right: 9, top: 9 }} />
        <span className="cassette__screw" style={{ left: 9, bottom: 9 }} />
        <span className="cassette__screw" style={{ right: 9, bottom: 9 }} />
        <div className="cassette__label">
          <div className="cassette__band" aria-hidden="true" />
          <div className="cassette__meta" aria-hidden="true">
            <span className="cassette__side">A</span>
            <span>songbird · c60</span>
          </div>
          {title ? (
            <div className="cassette__titled">
              <span className="cassette__title">{title}</span>
              {name && <span className="cassette__for">for {name.toLowerCase()}</span>}
            </div>
          ) : (
            <label className="cassette__write">
              <span className="cassette__write-for" aria-hidden="true">
                for
              </span>
              <input
                className="cassette__name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="a name"
                aria-label="who the song is for (optional)"
                maxLength={18}
                spellCheck={false}
                autoComplete="off"
                disabled={!editable}
              />
            </label>
          )}
          <div className="cassette__window" aria-hidden="true">
            <div className="cassette__reel cassette__reel--l">
              <Reel pack={1 - w * 0.92} />
            </div>
            <div className="cassette__reel cassette__reel--r">
              <Reel pack={0.08 + w * 0.92} />
            </div>
            <span className="cassette__glass" />
          </div>
        </div>
        <div className="cassette__mouth" aria-hidden="true">
          <span className="cassette__pin" />
          <span className="cassette__pad" />
          <span className="cassette__pin" />
        </div>
      </div>
    </div>
  );
}
