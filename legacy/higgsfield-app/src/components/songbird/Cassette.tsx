import type { CSSProperties } from "react";
import { MACHINE_LINES } from "../../lib/song";
import type { Phase } from "../../lib/useSongbird";

/**
 * The cassette in its bay: acetate window, two spools, tape, a head that warms
 * when it finds a line, and a paper label you can write on.
 *
 * The spool sizes are the tape counter: the left one gives up its tape as the
 * song is read, the right one takes it.
 */
export function Cassette({
  name,
  setName,
  phase,
  retake,
  progress,
}: {
  name: string;
  setName: (value: string) => void;
  phase: Phase;
  retake: boolean;
  progress: number;
}) {
  const spinning = phase === "working" || phase === "playing";
  const out = phase === "done" || phase === "revealed" || phase === "playing";
  const read = Math.min(1, Math.max(0, progress));
  const left = `${Math.round(62 - read * 24)}px`;
  const right = `${Math.round(22 + read * 30)}px`;

  return (
    <div className="cassette" data-spinning={spinning} data-retake={retake} data-out={out}>
      <div className="cassette__bay" aria-hidden="true" />
      <div className="cassette__shell">
        <div className="cassette__window">
          <span className="cassette__spool" style={{ ["--spool" as string]: left } as CSSProperties}>
            <span className="reel">
              <span className="reel__spoke" />
              <span className="reel__spoke" />
              <span className="reel__spoke" />
              <span className="reel__hub" />
            </span>
          </span>
          <span className="cassette__tape" aria-hidden="true" />
          <span className="cassette__spool" style={{ ["--spool" as string]: right } as CSSProperties}>
            <span className="reel">
              <span className="reel__spoke" />
              <span className="reel__spoke" />
              <span className="reel__spoke" />
              <span className="reel__hub" />
            </span>
          </span>
          <span className="cassette__head" data-live={spinning} aria-hidden="true">
            <span className="cassette__head-glow" />
          </span>
          <span className="cassette__screw cassette__screw--tl" aria-hidden="true" />
          <span className="cassette__screw cassette__screw--tr" aria-hidden="true" />
          <span className="cassette__screw cassette__screw--bl" aria-hidden="true" />
          <span className="cassette__screw cassette__screw--br" aria-hidden="true" />
        </div>

        <div className="cassette__label">
          <span className="cassette__label-top">
            <span className="cassette__label-brand">songbird</span>
            <span className="cassette__label-side">side a</span>
          </span>
          <label className="cassette__write">
            <span className="cassette__write-for">for</span>
            <input
              className="cassette__name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={MACHINE_LINES.labelHint}
              aria-label="write a name on the tape label"
              maxLength={16}
              spellCheck={false}
              autoComplete="off"
              disabled={phase === "working"}
            />
            <span className="cassette__rule" aria-hidden="true" />
          </label>
          <span className="cassette__label-foot">{MACHINE_LINES.tapeSpec}</span>
          <span className="cassette__retake" data-on={retake}>
            {MACHINE_LINES.retake}
          </span>
          <span className="cassette__wear" aria-hidden="true" />
        </div>
      </div>
      <span className="cassette__eject-mark" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
