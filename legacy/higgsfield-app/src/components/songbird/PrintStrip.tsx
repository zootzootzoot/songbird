import { MACHINE_LINES } from "../../lib/song";
import type { Phase } from "../../lib/useSongbird";

/**
 * The printer slot on the deck's front: it feeds out a paper strip with the line
 * the machine is hearing, so the song is legible while it is being made.
 */
export function PrintStrip({
  printed,
  reading,
  total,
  retake,
  phase,
  lyrics,
  activeLine,
}: {
  printed: number;
  reading: number;
  total: number;
  retake: boolean;
  phase: Phase;
  lyrics: string[];
  activeLine: number;
}) {
  const playing = phase === "playing" && activeLine >= 0;

  const line = retake
    ? MACHINE_LINES.workingLater
    : playing
      ? lyrics[activeLine]
      : printed > 0
        ? lyrics[Math.min(printed, lyrics.length) - 1]
        : phase === "working"
          ? MACHINE_LINES.working
          : "it prints the words as it hears them";

  const hint =
    phase === "empty"
      ? "the printer"
      : phase === "working"
        ? MACHINE_LINES.readout
        : phase === "done"
          ? MACHINE_LINES.done
          : phase === "revealed"
            ? MACHINE_LINES.play
            : MACHINE_LINES.playing;

  return (
    <div className="readout" data-retake={retake}>
      <span className="readout__slot" aria-hidden="true" />
      <div className="readout__paper">
        <span className="readout__hint">{hint}</span>
        <p className="readout__line" aria-live="polite">
          {line}
        </p>
        <span className="readout__tally" aria-hidden="true">
          {reading >= 0 ? `${reading + 1} / ${total}` : `${printed} / ${total}`}
        </span>
        <span className="readout__perf" aria-hidden="true" />
      </div>
    </div>
  );
}
