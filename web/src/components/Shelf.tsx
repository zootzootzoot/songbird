import type { CSSProperties } from "react";
import type { TapeSummary } from "../lib/types";

const INKS = ["#e0472a", "#1d4a68", "#efb02f", "#2a2420"];

/**
 * The back catalogue: cassette spines standing on a shelf, catalogue numbers
 * out. Pull one and it goes straight into the deck; no studio needed.
 */
export function Shelf({
  tapes,
  current,
  busy,
  onPick,
}: {
  tapes: TapeSummary[];
  current: string | null;
  busy: boolean;
  onPick: (id: string) => void;
}) {
  if (!tapes.length) return null;
  const shown = [...tapes].sort((a, b) => (a.catalog ?? a.id).localeCompare(b.catalog ?? b.id)).slice(-10);
  return (
    <nav className="shelf" aria-label="the back catalogue" style={{ ["--n" as string]: shown.length } as CSSProperties}>
      <span className="shelf__label eyebrow">the back catalogue</span>
      <ul className="shelf__row">
        {shown.map((t, i) => {
          const ink = INKS[i % INKS.length];
          return (
            <li key={t.id}>
              <button
                type="button"
                className="spine"
                data-current={current === t.id}
                disabled={busy}
                onClick={() => onPick(t.id)}
                style={{ ["--spine" as string]: ink } as CSSProperties}
                aria-label={`play ${t.catalog ?? ""} "${t.title ?? t.id}"${t.artist ? ` by ${t.artist}` : ""}`}
              >
                <span className="spine__cat">{t.catalog ?? "sb"}</span>
                <span className="spine__title">{t.title ?? "untitled"}</span>
                <span className="spine__dot" aria-hidden="true" />
              </button>
              <span className="spine__tip" aria-hidden="true">
                {t.cover && <img src={t.cover} alt="" />}
                <span>
                  <b>{t.title}</b>
                  <span>{t.artist ?? t.dedication}</span>
                  {t.genre && <i>{t.genre}</i>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <span className="shelf__plank" aria-hidden="true" />
    </nav>
  );
}
