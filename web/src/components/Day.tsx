import { useRef, useState, type CSSProperties } from "react";
import type { Phase } from "../lib/useDeck";
import { useRecorder } from "../lib/useRecorder";
import { Print, type PrintState } from "./Print";

export type DayItem = { key: string; src: string; number: number; state: PrintState; label: string; video?: boolean };

function Mic({ onText, disabled }: { onText: (t: string) => void; disabled: boolean }) {
  const mic = useRecorder(onText);
  const live = mic.state === "recording" || mic.state === "asking";
  const label =
    mic.state === "recording"
      ? "listening. let go when you're done."
      : mic.state === "hearing"
        ? "writing down what you said"
        : "hold to tell the producer one thing";
  return (
    <div className="mic" data-state={mic.state}>
      <button
        type="button"
        className="mic__button"
        aria-label={label}
        aria-pressed={live}
        disabled={disabled || mic.state === "hearing"}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          void mic.start();
        }}
        onPointerUp={mic.stop}
        onPointerCancel={mic.stop}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            void mic.start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            mic.stop();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ ["--lvl" as string]: mic.level } as CSSProperties}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8.5" y="3" width="7" height="12" rx="3.5" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" />
        </svg>
        <span className="mic__ring" aria-hidden="true" />
      </button>
      <span className="mic__label" aria-live="polite">
        {mic.message || label}
      </span>
    </div>
  );
}

const SLOTS = [0, 1, 2, 3, 4, 5];

/**
 * The day: a light table the prints are laid on, and a line for the machine.
 * Empty, the whole table is the drop target.
 */
export function Day({
  items,
  phase,
  count,
  min,
  canRemove,
  onRemove,
  onFiles,
  onPick,
  onSample,
  note,
  setNote,
  noteEditable,
  notice,
  cast = false,
}: {
  items: DayItem[];
  phase: Phase;
  count: number;
  min: number;
  canRemove: boolean;
  onRemove: (key: string) => void;
  onFiles: (files: FileList) => void;
  onPick: () => void;
  onSample: () => void;
  note: string;
  setNote: (v: string, spoken?: boolean) => void;
  noteEditable: boolean;
  notice?: string | null;
  cast?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const locked = phase === "sending" || phase === "working";
  const empty = items.length === 0;

  return (
    <section className="day" aria-label="the day">
      <header className="day__head">
        <span className="eyebrow">{cast ? "the band" : "the day"}</span>
        <span className="eyebrow eyebrow--dim">
          {phase === "done" ? `${count} on the tape` : `${count} of 6`}
        </span>
      </header>

      <div
        className="table"
        data-over={over}
        data-empty={empty}
        onDragEnter={(e) => {
          if (locked) return;
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => {
          if (locked) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (!locked && e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
        }}
      >
        <ol className="table__grid" aria-label={`${items.length} of 6 pictures`}>
          {SLOTS.map((slot) => {
            const item = items[slot];
            return (
              <li key={item ? item.key : `slot-${slot}`} className="table__slot" data-filled={Boolean(item)}>
                {item ? (
                  <>
                    <Print src={item.src} index={slot} number={item.number} state={item.state} label={item.label} video={item.video} />
                    {canRemove && (
                      <button type="button" className="table__remove" onClick={() => onRemove(item.key)} aria-label={`take out picture ${slot + 1}`}>
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M3 3l6 6M9 3l-6 6" />
                        </svg>
                      </button>
                    )}
                  </>
                ) : (
                  <span className="table__ghost" aria-hidden="true">
                    {String(slot + 1).padStart(2, "0")}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {empty && (
          <div className="table__invite">
            <p className="table__invite-line">drop today's photos here</p>
            <p className="table__invite-sub">three to six. short clips welcome; they move.</p>
            <div className="table__actions">
              <button type="button" className="btn btn--ink" onClick={onPick}>
                choose pictures
              </button>
              <button type="button" className="btn btn--ghost" onClick={onSample}>
                use the sample roll
              </button>
            </div>
          </div>
        )}
        {over && <div className="table__drop">let go</div>}
      </div>

      {notice && <p className="day__notice" role="status">{notice}</p>}
      {!empty && !locked && phase !== "done" && (
        <div className="day__more">
          {count < 6 && (
            <button type="button" className="link" onClick={onPick}>
              add more
            </button>
          )}
          <button type="button" className="link" onClick={onSample}>
            {count ? "swap for the sample roll" : "use the sample roll"}
          </button>
          <span className="day__need">{count >= min ? "ready. pull the lever." : `${min - count} more to go.`}</span>
        </div>
      )}
      {phase === "done" && (
        <div className="day__more">
          <button type="button" className="link" onClick={onPick}>
            start a new day
          </button>
          <button type="button" className="link" onClick={onSample}>
            use the sample roll
          </button>
        </div>
      )}

      <div className="note" data-locked={!noteEditable} hidden={phase === "done"}>
        <label className="eyebrow" htmlFor="deck-note">
          a word with the producer <span className="eyebrow--dim">(optional)</span>
        </label>
        <div className="note__row">
          <input
            id="deck-note"
            className="note__input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="she named the snail gary"
            maxLength={200}
            disabled={!noteEditable}
            autoComplete="off"
          />
        </div>
        <Mic onText={(t) => setNote(t, true)} disabled={!noteEditable} />
      </div>
    </section>
  );
}
