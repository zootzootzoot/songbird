import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getTape } from "../lib/api";
import { formatTime } from "../lib/copy";
import type { Tape } from "../lib/types";
import { Cover, CoverTitle, HeroCrop } from "./Cover";
import { RisoFilters } from "./Halftone";
import { Print } from "./Print";
import { sections } from "./JCard";

/**
 * True-size J-card for a standard compact cassette case (Philips / Norelco).
 * One sheet, printed on one side, folded on the marks:
 *
 *   | flap 15.9 | spine 12.7 | front 63.5 | inside 63.0 | inside 62.5 |  x 101.6 mm tall
 *
 * Flap and spine fold back behind the front (mountain folds); the two inside
 * panels fold back behind the front too, so they face the tape and read when
 * the card is unfolded. Stickers below, to cut out.
 */
export const PANELS = { flap: 15.9, spine: 12.7, front: 63.5, inA: 63.0, inB: 62.5 } as const;
export const JCARD_H = 101.6;
export const JCARD_W = PANELS.flap + PANELS.spine + PANELS.front + PANELS.inA + PANELS.inB;

const folds = [PANELS.flap, PANELS.flap + PANELS.spine, PANELS.flap + PANELS.spine + PANELS.front, PANELS.flap + PANELS.spine + PANELS.front + PANELS.inA];

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

function roleOf(tape: Tape, i: number) {
  return tape.band?.find((b) => b.photo === i)?.role ?? null;
}

export function PrintSheet({ tape }: { tape: Tape }) {
  return (
    <div className="sheet" style={{ ["--jw" as string]: `${JCARD_W}mm`, ["--jh" as string]: `${JCARD_H}mm` } as CSSProperties}>
      <div className="sheet__card-zone">
        <div className="pj" style={{ width: `${JCARD_W}mm`, height: `${JCARD_H}mm` }}>
          <section className="pj__panel pj__flap" style={{ width: `${PANELS.flap}mm` }}>
            <div className="pj__rot">
              <span className="pj__flap-brand">songbird records</span>
              <span className="pj__flap-meta">{tape.catalog ?? "side a"} · {formatTime(tape.duration)}</span>
            </div>
          </section>
          <section className="pj__panel pj__spine" style={{ width: `${PANELS.spine}mm` }}>
            <div className="pj__rot">
              <span className="pj__spine-cat">{tape.catalog ?? "sb"}</span>
              <span className="pj__spine-title">{tape.title}</span>
              <span className="pj__spine-for">{tape.artist ?? tape.name ?? ""}</span>
            </div>
          </section>
          <section className="pj__panel pj__front" style={{ width: `${PANELS.front}mm` }}>
            <Cover tape={tape} className="pj__cover" />
            <CoverTitle tape={tape} className="pj__covertitle" />
          </section>
          <section className="pj__panel pj__in pj__inA" style={{ width: `${PANELS.inA}mm` }}>
            <p className="pj__kicker">the band</p>
            <ol className="pj__photos">
              {tape.photos.map((p, i) => (
                <li key={i}>
                  <Print
                    src={p.src}
                    index={i}
                    state={{ cutout: p.cutout, box: p.box, hero: p.hero, role: roleOf(tape, i) }}
                    still
                  />
                </li>
              ))}
            </ol>
            <div className="pj__notes">
              {tape.genre && <p className="pj__genre">{tape.genre}</p>}
              {tape.liner && <p className="pj__liner">{tape.liner}</p>}
              {tape.note && (
                <p className="pj__note">
                  <span>you told the producer:</span> {tape.note}
                </p>
              )}
            </div>
          </section>
          <section className="pj__panel pj__in pj__inB" style={{ width: `${PANELS.inB}mm` }}>
            <p className="pj__kicker">the words</p>
            <div className="pj__lyrics">
              {sections(tape).map((sec, i) => (
                <div key={i} className="pj__section">
                  {sec.name && <span className="pj__section-name">{sec.name}</span>}
                  {sec.lines.map((l) => (
                    <p key={l.index}>{l.text}</p>
                  ))}
                </div>
              ))}
            </div>
            <dl className="pj__credits">
              {tape.credits.map((c, i) => (
                <div key={i}>
                  <dt>{c.role}</dt>
                  <dd>{c.model}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        {/* crop marks at the four corners, fold marks top and bottom */}
        <svg
          className="sheet__marks"
          viewBox={`-8 -8 ${JCARD_W + 16} ${JCARD_H + 16}`}
          style={{ width: `${JCARD_W + 16}mm`, height: `${JCARD_H + 16}mm` }}
          aria-hidden="true"
        >
          {[
            [0, 0],
            [JCARD_W, 0],
            [0, JCARD_H],
            [JCARD_W, JCARD_H],
          ].map(([x, y], i) => {
            const dx = x === 0 ? -1 : 1;
            const dy = y === 0 ? -1 : 1;
            return (
              <g key={i} className="mark">
                <line x1={x + dx * 1.5} y1={y} x2={x + dx * 7} y2={y} />
                <line x1={x} y1={y + dy * 1.5} x2={x} y2={y + dy * 7} />
              </g>
            );
          })}
          {folds.map((x, i) => (
            <g key={`f${i}`} className="mark mark--fold">
              <line x1={x} y1={-7} x2={x} y2={-1.5} />
              <line x1={x} y1={JCARD_H + 1.5} x2={x} y2={JCARD_H + 7} />
            </g>
          ))}
        </svg>
      </div>
      <p className="sheet__howto">
        cut on the corner marks. fold back on the short marks, all mountain folds: flap and spine behind the front, the two
        inside panels behind the front. it fits a standard cassette case.
      </p>
      <div className="sheet__stickers">
        <p className="sheet__stickers-title">the band, as stickers. cut on the grey line.</p>
        <ul>
          {tape.photos.map((p, i) => (
            <li key={i}>
              {p.cutout ? (
                <img className="sheet__sticker" src={p.cutout} alt={p.hero} />
              ) : (
                <span className="sheet__badge">
                  <HeroCrop src={p.src} box={p.box} />
                </span>
              )}
              <span className="sheet__sticker-name">{p.hero}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PrintView({ id, initial, onBack }: { id: string; initial: Tape | null; onBack: () => void }) {
  const [tape, setTape] = useState<Tape | null>(initial && initial.id === id ? initial : null);
  const [missing, setMissing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  useEffect(() => {
    if (tape) return;
    let alive = true;
    getTape(id)
      .then((t) => {
        if (!alive) return;
        if (t) setTape(t);
        else setMissing(true);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id, tape]);

  useEffect(() => {
    document.documentElement.classList.add("is-print-view");
    return () => document.documentElement.classList.remove("is-print-view");
  }, []);

  useEffect(() => {
    if (!tape || printed.current || !root.current) return;
    const el = root.current;
    let cancelled = false;
    Promise.all([document.fonts?.ready ?? Promise.resolve(), waitForImages(el)]).then(() => {
      if (cancelled || printed.current) return;
      printed.current = true;
      if (new URLSearchParams(location.search).has("noprint")) return;
      window.setTimeout(() => window.print(), 450);
    });
    return () => {
      cancelled = true;
    };
  }, [tape]);

  return (
    <div className="printview" ref={root}>
      <RisoFilters />
      <div className="printview__bar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          back to the deck
        </button>
        <span className="printview__hint">landscape, us letter or a4, scale 100%, background graphics on.</span>
        <button type="button" className="btn btn--vermilion" onClick={() => window.print()} disabled={!tape}>
          print
        </button>
      </div>
      {tape ? (
        <div className="printview__page">
          <PrintSheet tape={tape} />
        </div>
      ) : (
        <p className="printview__wait">{missing ? "couldn't find that tape." : "finding the tape..."}</p>
      )}
    </div>
  );
}
