import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { pad2 } from "./model";

export type SheetLine = {
  index: number;
  text: string;
  photo: number | null;
  section: string;
  /** characters typed so far */
  typed: number;
  state: "wait" | "typing" | "done";
  /** first line of its section */
  head: boolean;
};

export type LogLine = { key: string; t: string; src: string; text: string; tone?: "vu" | "cue" | "tally" | "dim" };

export type Call =
  | { mode: "sending"; files: number }
  | { mode: "looking"; files: number }
  | {
      mode: "audition";
      k: number;
      of: number;
      hero: string;
      seen: string;
      typed: number;
      clock: string;
      notes: string[];
    }
  | {
      mode: "call";
      genre: string;
      why: string;
      whyTyped: number;
      bpm: number;
      musicKey: string;
      title: string | null;
    };

type Props = {
  who: string;
  label: string;
  stageClock: string;
  call: Call;
  sheet: SheetLine[];
  lineN: number;
  log: LogLine[];
  halted: ReactNode;
  reduced: boolean;
};

export function Talkback({ who, label, stageClock, call, sheet, lineN, log, halted, reduced }: Props) {
  return (
    <section className="rm-panel rm-talk" aria-label="talkback">
      <header className="rm-head">
        <span className="label">Talkback</span>
        <span className="rm-talk__who label">{who}</span>
        <span className="rm-talk__label" aria-live="polite">
          {label}
        </span>
        <span className="rm-head__read num">{stageClock}</span>
      </header>

      {halted ?? (
        <>
          <CallBlock call={call} reduced={reduced} />
          <Sheet sheet={sheet} lineN={lineN} waiting={call.mode !== "call"} />
        </>
      )}

      <div className="rm-log" aria-hidden>
        <div className="rm-log__rows">
          {log.map((l) => (
            <div key={l.key} className="rm-log__row" data-tone={l.tone}>
              <span className="num rm-log__t">{l.t}</span>
              <span className="rm-log__src">{l.src}</span>
              <span className="rm-log__text">{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CallBlock({ call, reduced }: { call: Call; reduced: boolean }) {
  if (call.mode === "sending" || call.mode === "looking") {
    return (
      <div className="rm-call" data-mode={call.mode}>
        <div className="rm-call__kick label">{call.mode === "sending" ? "Uplink" : "Muse Spark 1.3 / Look"}</div>
        <Fit className="rm-call__big rm-call__big--wait" max={120} min={24} watch={call.mode}>
          {call.mode === "sending" ? `sending ${call.files} to the studio` : `looking at ${call.files} pictures`}
        </Fit>
        <div className="rm-call__sub">
          {call.mode === "sending"
            ? "the day goes up to the gpu. nothing has been decided yet."
            : "one look at the whole day: what each picture is about, and the order it happened in."}
        </div>
      </div>
    );
  }

  if (call.mode === "audition") {
    return (
      <div className="rm-call" data-mode="audition">
        <div className="rm-call__kick label">
          <span className="rm-call__lamp" />
          Muse Wonder 1.0 is producing <span className="rm-call__sep">/</span> auditioning ch {pad2(call.k + 1)} of {pad2(call.of)}
        </div>
        <div className="rm-call__row">
          <Fit className="rm-call__big rm-call__big--hero" max={110} min={22} watch={`${call.k}-${call.hero}`} land={!reduced}>
            {call.hero}
          </Fit>
          <div className="rm-call__clock">
            <span className="label">Producing</span>
            <span className="num">{call.clock}</span>
          </div>
        </div>
        <div className="rm-call__sub">
          <span className="rm-call__src label">Spark saw</span>
          <span className="rm-type">
            {call.seen.slice(0, call.typed)}
            {call.typed < call.seen.length && <i className="rm-caret" />}
          </span>
        </div>
        {call.notes.length > 0 && (
          <div className="rm-call__notes">
            {call.notes.map((n) => (
              <span key={n} className="rm-note">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rm-call" data-mode="call">
      <div className="rm-call__kick label">
        The call <span className="rm-call__sep">/</span> Muse Wonder 1.0
      </div>
      <Fit className="rm-call__big rm-call__big--genre" max={150} min={26} watch={call.genre} land={!reduced}>
        {call.genre}
      </Fit>
      <div className="rm-call__meta">
        <div className="rm-readout">
          <span className="label">BPM</span>
          <span className="num">{call.bpm}</span>
        </div>
        <div className="rm-readout">
          <span className="label">Key</span>
          <span className="num">{call.musicKey}</span>
        </div>
        <div className="rm-readout rm-readout--title">
          <span className="label">Title</span>
          <span className="rm-readout__title">{call.title ?? "..."}</span>
        </div>
      </div>
      <p className="rm-call__why">
        {call.why.slice(0, call.whyTyped)}
        {call.whyTyped < call.why.length && <i className="rm-caret" />}
      </p>
    </div>
  );
}

function sectionTag(section: string): string {
  const s = section.trim().toLowerCase();
  const v = s.match(/verse\s*(\d+)/);
  if (v) return `V${v[1]}`;
  if (s.startsWith("pre")) return "PRE";
  if (s.startsWith("chorus")) return "CHO";
  if (s.startsWith("bridge")) return "BRG";
  if (s.startsWith("intro")) return "INT";
  if (s.startsWith("outro")) return "OUT";
  if (s.startsWith("refrain")) return "REF";
  return s.slice(0, 3).toUpperCase() || "---";
}

function Sheet({ sheet, lineN, waiting }: { sheet: SheetLine[]; lineN: number; waiting: boolean }) {
  const cols = lineN > 9 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(lineN / cols));
  return (
    <div className="rm-sheet" data-empty={lineN === 0 || undefined}>
      <div className="rm-sheet__head">
        <span className="label">Lyric sheet</span>
        <span className="num rm-sheet__count">{lineN ? `${pad2(lineN)} LN` : "--"}</span>
      </div>
      {lineN === 0 ? (
        <ol className="rm-sheet__grid rm-sheet__grid--blank" style={{ gridTemplateRows: "repeat(10, minmax(0, 1fr))", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {Array.from({ length: 20 }, (_, i) => (
            <li key={i} className="rm-line" data-state="wait">
              <span className="num rm-line__no">{pad2(i + 1)}</span>
              <span className="rm-line__sec" />
              <span className="rm-line__text" />
              <span className="rm-line__ch" />
            </li>
          ))}
          <li className="rm-sheet__note label">{waiting ? "no sheet yet. the producer writes it in one go." : "no lines"}</li>
        </ol>
      ) : (
        <ol
          className="rm-sheet__grid"
          style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {sheet.map((l) => (
            <li key={l.index} className="rm-line" data-state={l.state}>
              <span className="num rm-line__no">{pad2(l.index + 1)}</span>
              <span className="rm-line__sec num">{l.head ? sectionTag(l.section) : ""}</span>
              <span className="rm-line__text">
                {l.state === "wait" ? "" : l.text.slice(0, l.typed)}
                {l.state === "typing" && <i className="rm-caret" />}
              </span>
              <span className="num rm-line__ch">{l.photo === null || l.state === "wait" ? "" : `CH${pad2(l.photo + 1)}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Big display type sized to its box: the largest font size (between min and max)
 * at which the text fits without overflow. Measured before the landing animation
 * is armed, so the expanding-width entrance doesn't skew the fit.
 */
function Fit({
  children,
  className,
  max,
  min,
  watch,
  land = false,
}: {
  children: ReactNode;
  className: string;
  max: number;
  min: number;
  watch: string;
  land?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useLayoutEffect(() => {
    const b = box.current;
    const t = text.current;
    if (!b || !t) return;
    const fit = () => {
      // measure at the final width axis, never mid-landing (the entrance animates wdth 62 -> 125)
      const anim = t.style.animation;
      t.style.animation = "none";
      let lo = min;
      let hi = max;
      for (let i = 0; i < 9; i += 1) {
        const mid = (lo + hi) / 2;
        t.style.fontSize = `${mid}px`;
        if (t.scrollWidth <= b.clientWidth + 1 && t.offsetHeight <= b.clientHeight + 1) lo = mid;
        else hi = mid;
      }
      t.style.fontSize = `${Math.floor(lo)}px`;
      t.style.animation = anim;
    };
    fit();
    setArmed(watch);
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    if (document.fonts && document.fonts.status !== "loaded") void document.fonts.ready.then(fit);
    return () => ro.disconnect();
  }, [watch, max, min]);

  return (
    <div ref={box} className={className}>
      <span ref={text} className="rm-fit" data-land={land && armed === watch ? watch : undefined} key={watch}>
        {children}
      </span>
    </div>
  );
}
