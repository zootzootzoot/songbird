import type { Player } from "../../lib/usePlayer";
import type { Tape } from "../../lib/types";

/** The result: the single's music video. See DESIGN.md "The video". */
export function Video({ tape, player, autoplay, onExit }: { tape: Tape; player: Player; autoplay: boolean; onExit: () => void }) {
  void autoplay;
  return (
    <main className="video">
      {tape.title}
      <button onClick={() => void player.play()}>play</button>
      <button onClick={onExit}>back</button>
    </main>
  );
}
