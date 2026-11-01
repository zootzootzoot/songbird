/**
 * The amber lamp. It is also the only shortcut in the machine: tapping it while
 * the deck is working hurries it along, which the print strip mentions.
 */
export function Lamp({
  on,
  pulse,
  hurryEnabled,
  onHurry,
}: {
  on: boolean;
  pulse: boolean;
  hurryEnabled: boolean;
  onHurry: () => void;
}) {
  return (
    <div className="lamp" data-on={on} data-pulse={pulse}>
      <button
        type="button"
        className="lamp__button"
        onClick={onHurry}
        aria-label={hurryEnabled ? "tap the lamp to hurry the machine along" : "the lamp"}
        title={hurryEnabled ? "hurry it along" : undefined}
      >
        <span className="lamp__collar" aria-hidden="true" />
        <span className="lamp__bulb" aria-hidden="true" />
        <span className="lamp__shine" aria-hidden="true" />
        <span className="lamp__screw" aria-hidden="true" />
      </button>
      <span className="dymo lamp__label">lamp</span>
    </div>
  );
}
