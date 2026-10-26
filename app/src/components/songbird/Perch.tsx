import type { BirdMood } from "../../lib/useSongbird";
import { Bird } from "./Bird";

/**
 * The perch: a cocoa dowel on two brass brackets, and the bird on top of it.
 * The bird is off to the right of centre, the way a real one would land.
 */
export function Perch({ mood }: { mood: BirdMood }) {
  return (
    <div className="perch">
      <div className="perch__plate">
        <span className="perch__word">songbird</span>
        <span className="perch__model">sb-6</span>
      </div>
      <div className="perch__rig" aria-hidden="true">
        <span className="perch__bracket perch__bracket--left" />
        <span className="perch__bracket perch__bracket--right" />
        <span className="perch__dowel" />
      </div>
      <div className="perch__seat">
        <Bird mood={mood} />
      </div>
    </div>
  );
}