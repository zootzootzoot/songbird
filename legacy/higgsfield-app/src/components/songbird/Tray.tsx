import { useRef, useState } from "react";
import { MACHINE_LINES } from "../../lib/song";
import type { Phase } from "../../lib/useSongbird";

/**
 * The tray at the bottom of the deck. It takes a drop, a pick, or the sample
 * roll, and it is the only place in the app that invites you in.
 */
export function Tray({
  count,
  max,
  phase,
  onFiles,
  onSample,
}: {
  count: number;
  max: number;
  phase: Phase;
  onFiles: (files: FileList) => void;
  onSample: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const locked = phase === "working";

  return (
    <div
      className="tray"
      data-over={over}
      data-locked={locked}
      onDragOver={(event) => {
        event.preventDefault();
        if (!locked) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (locked) return;
        if (event.dataTransfer?.files?.length) onFiles(event.dataTransfer.files);
      }}
    >
      <span className="tray__lip" aria-hidden="true" />
      <span className="tray__count" aria-hidden="true">
        {count} of {max}
      </span>

      <button
        type="button"
        className="tray__cta"
        onClick={() => input.current?.click()}
        disabled={locked}
      >
        {MACHINE_LINES.empty}
      </button>
      <p className="tray__sub">{over ? "let go, it can take it." : MACHINE_LINES.emptySub}</p>

      <button type="button" className="dymo tray__sample" onClick={onSample} disabled={locked}>
        {MACHINE_LINES.sampleRoll}
      </button>

      <input
        ref={input}
        className="tray__input"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <span className="tray__shadow" aria-hidden="true" />
    </div>
  );
}
