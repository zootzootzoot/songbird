import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { formatTime } from "../lib/copy";
import type { Health } from "../lib/api";
import { LINE_STAGGER, type LogEntry, type Phase, type Work } from "../lib/useDeck";
import { CHAIN } from "./Device";

function Reels({ spinning }: { spinning: boolean }) {
  return (
    <span className="mini-reels" data-spinning={spinning} aria-hidden="true">
      {[0, 1].map((i) => (
        <svg key={i} viewBox="-12 -12 24 24">
          <circle r="11" className="mini-reels__pack" />
          <g className="mini-reels__hub">
            <circle r="5" />
            {[0, 120, 240].map((a) => (
              <rect key={a} x="-1" y="-5" width="2" height="2.6" transform={`rotate(${a})`} />
            ))}
          </g>
        </svg>
      ))}
    </span>
  );
}

function Bar({ label, value }: { label: string; value?: number }) {
  return (
    <div className="score-bar">
      <span>{label}</span>
      <span className="score-bar__track">
        <span className="score-bar__fill" style={{ ["--v" as string]: (value ?? 0) / 10 } as CSSProperties} />
      </span>
      <b>{value !== undefined ? value.toFixed(1) : "-"}</b>
    </div>
  );
}

/**
 * The session sheet. Everything that happens in the studio is printed on it as
 * it happens: who is working, what Muse Spark saw, who SAM cast, the
 * producer's call, the lyric sheet by section, the takes and what A&R thought.
 */
export function Receipt({
  phase,
  work,
  thumb,
  photoForLine,
  health,
  error,
  onRetry,
  onShelf,
  canRetry,
}: {
  phase: Phase;
  work: Work;
  thumb: (index: number) => { src: string; sticker: boolean } | undefined;
  photoForLine: (eventPhoto: number | null) => number | null;
  health: Health | null;
  error: { message: string; stage?: string } | null;
  onRetry: () => void;
  onShelf: () => void;
  canRetry: boolean;
}) {
  const started = useRef(0);
  const stamps = useRef(new Map<string, number>());
  const scroller = useRef<HTMLDivElement>(null);
  const working = phase === "working" || phase === "sending";
  const [, tick] = useState(0);

  useEffect(() => {
    if (phase === "sending") {
      started.current = performance.now();
      stamps.current.clear();
    }
  }, [phase]);

  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [working]);

  const now = () => (performance.now() - (started.current || performance.now())) / 1000;
  work.log.forEach((e) => {
    if (!stamps.current.has(e.key)) stamps.current.set(e.key, now());
  });

  const delays = new Map<string, number>();
  let groupAt = -99;
  let n = 0;
  work.log.forEach((e) => {
    const t = stamps.current.get(e.key) ?? 0;
    if (Math.abs(t - groupAt) > 0.35) {
      groupAt = t;
      n = 0;
    }
    delays.set(e.key, n * (e.kind === "line" ? LINE_STAGGER * 0.6 : e.kind === "band" ? 0.25 : 0.1));
    n += 1;
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [work.log.length, phase, work.takes]);

  const lastStage = [...work.log].reverse().find((e) => e.kind === "stage");
  let lastSection = "";

  const row = (e: LogEntry) => {
    const style = { animationDelay: `${delays.get(e.key) ?? 0}s` } as CSSProperties;
    switch (e.kind) {
      case "stage": {
        const live = working && e === lastStage;
        return (
          <li key={e.key} className="r-stage" data-live={live} style={style}>
            <span className="r-stage__label">{e.label}</span>
            <span className="r-stage__model">{CHAIN[e.stage]?.model ?? ""}</span>
            <span className="r-stage__time">{formatTime(live ? now() : stamps.current.get(e.key) ?? 0)}</span>
          </li>
        );
      }
      case "seen":
        return (
          <li key={e.key} className="r-seen" style={style}>
            <span className="r-no">{String(e.photo + 1).padStart(2, "0")}</span>
            <span>
              <b>{e.hero}</b>
              <i>{e.seen.charAt(0).toLowerCase() + e.seen.slice(1)}</i>
            </span>
          </li>
        );
      case "cut":
        return (
          <li key={e.key} className="r-cut" data-ok={e.ok} style={style}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="4" cy="4.5" r="2.4" />
              <circle cx="4" cy="11.5" r="2.4" />
              <path d="M6 5.6 L14 12.5 M6 10.4 L14 3.5" />
            </svg>
            <span>
              {!e.ok ? `no ${e.hero} to cut. it plays from the photo.` : e.moving ? `followed the ${e.hero} through the clip` : `cut out the ${e.hero}`}
            </span>
          </li>
        );
      case "genre":
        return (
          <li key={e.key} className="r-genre" style={style}>
            <span className="r-kicker">the call</span>
            <b>{e.genre}</b>
            <i>{e.why}</i>
            <span className="r-genre__meta">
              {Math.round(e.bpm)} bpm · {e.musicKey.toLowerCase()}
            </span>
          </li>
        );
      case "title":
        return (
          <li key={e.key} className="r-title" style={style}>
            <span className="r-kicker">the single</span>
            {e.title}
          </li>
        );
      case "line": {
        const up = photoForLine(e.photo);
        const t = up !== null ? thumb(up) : undefined;
        const head = e.section && e.section !== lastSection ? e.section : "";
        if (e.section) lastSection = e.section;
        return (
          <li key={e.key} className="r-line" data-section-start={Boolean(head)} style={style}>
            {head && <span className="r-line__section">{head.toLowerCase()}</span>}
            <span className="r-line__mark">{t ? <img src={t.src} alt="" data-sticker={t.sticker} /> : null}</span>
            <span className="r-line__text">{e.text}</span>
          </li>
        );
      }
      case "band": {
        const t = thumb(e.photo);
        return (
          <li key={e.key} className="r-band" style={style}>
            <span className="r-band__sticker">{t && <img src={t.src} alt="" data-sticker={t.sticker} />}</span>
            <span>
              <b>{e.hero}</b>
              <i>{e.role}</i>
            </span>
          </li>
        );
      }
      case "take": {
        const tk = work.takes[e.index] ?? {};
        const judged = tk.verdict !== undefined;
        return (
          <li key={e.key} className="r-take" data-judged={judged} data-kept={tk.kept} data-cut={tk.cut} style={style}>
            <div className="r-take__head">
              <Reels spinning={!judged && working} />
              <span className="r-take__no">take {e.index + 1}</span>
              <span className="r-take__state">
                {tk.cut ? "cut" : judged ? `${tk.score?.toFixed(1)} / 10` : "in the can"}
              </span>
            </div>
            {tk.inKey != null && (
              <p className="r-take__tuner" data-off={tk.inKey < 0.75}>
                tuner: {Math.round(tk.inKey * 100)}% in key · sings {tk.vocalKey ?? "?"} over {tk.bandKey ?? "?"}
              </p>
            )}
            {judged && tk.cut && (
              <>
                <p className="r-take__verdict">off key. never reached the producer.</p>
                <span className="r-stamp" data-kept={false}>
                  cut
                </span>
              </>
            )}
            {judged && !tk.cut && (
              <>
                <div className="r-take__bars">
                  <Bar label="voice" value={tk.voice} />
                  <Bar label="words" value={tk.words} />
                  <Bar label="genre" value={tk.genre} />
                </div>
                <p className="r-take__verdict">{tk.verdict}</p>
                <span className="r-stamp" data-kept={tk.kept}>
                  {tk.kept ? "kept" : "rejected"}
                </span>
              </>
            )}
          </li>
        );
      }
      case "verdict":
        return null;
    }
  };

  const recordingNow = working && work.stage === "recording";
  const nextTake = Object.keys(work.takes).length;

  return (
    <div className="receipt" data-phase={phase}>
      <div className="receipt__scroll" ref={scroller}>
        <div className="receipt__paper">
          <header className="receipt__head">
            <span>songbird records</span>
            <span>{(working || phase === "error") && work.id ? `session ${work.id.replace(/^t_/, "")}` : "session sheet"}</span>
          </header>

          {(phase === "empty" || phase === "loaded") && (
            <div className="receipt__how">
              <p className="r-kicker">how a release gets made</p>
              <ol>
                <li>
                  <b>muse spark</b> looks at the day and names what mattered.
                </li>
                <li>
                  <b>sam 3.1</b> cuts each thing out. they are the band now.
                </li>
                <li>
                  <b>muse wonder</b> produces: picks the genre, writes the single, credits the band.
                </li>
                <li>
                  <b>ace-step</b>, the session band, records four takes.
                </li>
                <li>
                  <b>demucs</b> splits the singer from the band; the tuner cuts takes sung off key.
                </li>
                <li>
                  <b>muse spark 1.2</b> listens back like a&r. one take is kept.
                </li>
                <li>
                  <b>muse image</b> paints the sleeve. the tape is pressed.
                </li>
              </ol>
              <p className="receipt__foot">about three minutes, start to finish. the studio lights go down while it works.</p>
              {health && health.ok && health.band === false && (
                <p className="receipt__warn">the session band has gone home. the back catalogue still plays.</p>
              )}
            </div>
          )}

          {working && (
            <ol className="receipt__log" aria-live="polite" aria-relevant="additions">
              {phase === "sending" && !work.log.length && (
                <li className="r-stage r-stage--blink" data-live="true">
                  <span className="r-stage__label">threading the tape</span>
                </li>
              )}
              {work.log.map(row)}
              {recordingNow && nextTake < 4 && (
                <li className="r-take r-take--rolling" key={`rolling-${nextTake}`}>
                  <div className="r-take__head">
                    <Reels spinning />
                    <span className="r-take__no">take {nextTake + 1}</span>
                    <span className="r-take__state r-take__state--live">rolling</span>
                  </div>
                </li>
              )}
            </ol>
          )}

          {phase === "error" && (
            <div className="receipt__error" role="alert">
              {work.log.length > 0 && <ol className="receipt__log receipt__log--faded">{work.log.slice(-3).map(row)}</ol>}
              <p className="receipt__snag">the tape snagged.</p>
              <p className="receipt__msg">{error?.message}</p>
              {error?.stage && <p className="receipt__where">stopped while {error.stage}. nothing you did.</p>}
              <div className="receipt__actions">
                <button type="button" className="btn btn--vermilion" onClick={onRetry} disabled={!canRetry}>
                  try again
                </button>
                <button type="button" className="btn btn--ghost" onClick={onShelf}>
                  play something from the catalogue
                </button>
              </div>
            </div>
          )}
          <span className="receipt__tear" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
