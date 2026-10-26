import { useState } from "react";

/**
 * The lever. A moulded vermilion paddle in a slot: it leans when you press and
 * drops home with a thunk, and it stays down while the tape runs.
 */
export function Lever({
  onPull,
  disabled,
  down,
}: {
  onPull: () => void;
  disabled: boolean;
  down: boolean;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <div className="lever">
      <span className="lever__slot" aria-hidden="true" />
      <button
        type="button"
        className="lever__arm"
        data-pressed={pressed}
        data-down={down}
        disabled={disabled}
        aria-label="pull the lever to start the song"
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={() => {
          setPressed(false);
          onPull();
        }}
      >
        <span className="lever__shaft" aria-hidden="true" />
        <span className="lever__knob" aria-hidden="true">
          <span className="lever__knob-line" />
        </span>
      </button>
      <span className="dymo lever__label">pull</span>
    </div>
  );
}