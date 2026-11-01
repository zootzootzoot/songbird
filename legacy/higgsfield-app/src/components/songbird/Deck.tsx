import type { Songbird } from "../../lib/useSongbird";
import { Cassette } from "./Cassette";
import { Gauges } from "./Gauges";
import { Keys } from "./Keys";
import { Lamp } from "./Lamp";
import { Lever } from "./Lever";
import { Perch } from "./Perch";
import { PhotoStrip } from "./PhotoStrip";
import { PrintStrip } from "./PrintStrip";
import { Tray } from "./Tray";

const SCREWS = ["tl", "tr", "bl", "br"] as const;

/**
 * The deck. Every part is its own component; this file only decides what sits
 * next to what, and where the screws went in.
 */
export function Deck({ deck }: { deck: Songbird }) {
  const working = deck.phase === "working";
  const leverDown = working || deck.phase === "done" || deck.phase === "revealed" || deck.phase === "playing";

  return (
    <section className="deck" data-phase={deck.phase} aria-label="songbird tape deck">
      <Perch mood={deck.mood} />

      <div className="deck__body">
        <PhotoStrip photos={deck.photos} reading={deck.reading} working={working} />

        <Cassette
          name={deck.name}
          setName={deck.setName}
          phase={deck.phase}
          retake={deck.retake}
          progress={deck.progress}
        />

        <div className="deck__controls">
          <Gauges phase={deck.phase} />
          <Lamp
            on={deck.phase !== "empty"}
            pulse={deck.phase === "done"}
            hurryEnabled={working}
            onHurry={deck.hurry}
          />
          <Lever onPull={deck.pullLever} disabled={!deck.canPull} down={leverDown} />
        </div>

        <Keys phase={deck.phase} onPlay={deck.play} onStop={deck.stop} onEject={deck.eject} />

        <PrintStrip
          printed={deck.printed}
          reading={deck.reading}
          total={Math.max(deck.photos.length, 1)}
          retake={deck.retake}
          phase={deck.phase}
          lyrics={deck.lyrics}
          activeLine={deck.activeLine}
        />

        <Tray
          count={deck.photos.length}
          max={6}
          phase={deck.phase}
          onFiles={deck.addFiles}
          onSample={deck.addSample}
        />

        <div className="deck__slot" aria-hidden="true">
          <span className="deck__slot-lip" />
          <span className="deck__slot-gap" />
        </div>

        {SCREWS.map((corner) => (
          <span key={corner} className={`deck__screw deck__screw--${corner}`} aria-hidden="true">
            <span className="deck__screw-cut" />
          </span>
        ))}
        <span className="deck__chip deck__chip--a" aria-hidden="true" />
        <span className="deck__chip deck__chip--b" aria-hidden="true" />
        <span className="deck__scuff" aria-hidden="true" />
        <span className="deck__badge" aria-hidden="true">
          read write
        </span>
      </div>

      <span className="deck__foot deck__foot--left" aria-hidden="true" />
      <span className="deck__foot deck__foot--right" aria-hidden="true" />
    </section>
  );
}
