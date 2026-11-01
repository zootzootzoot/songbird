import { SONG, titleForName } from "../../lib/song";
import type { Phase, Photo } from "../../lib/useSongbird";
import { HalftonePhoto } from "./Halftone";

/**
 * The J-card. This is the thing you would keep in a drawer: a folded paper insert
 * with the title in heavy ink, the day's photographs printed small, and the words
 * in handwriting. It stays tucked in its slot until the tape is finished.
 */
export function JCard({
  photos,
  name,
  printed,
  activeLine,
  phase,
}: {
  photos: Photo[];
  name: string;
  printed: number;
  activeLine: number;
  phase: Phase;
}) {
  const out = phase === "revealed" || phase === "playing";
  const playing = phase === "playing" && activeLine >= 0;

  return (
    <section className="jcard-slot" data-out={out} aria-label="the printed j-card">
      <article className="jcard">
        <span className="jcard__fold" aria-hidden="true" />
        <header className="jcard__head">
          <span className="jcard__brand">songbird</span>
          <span className="jcard__side">{SONG.side}</span>
        </header>

        <h2 className="jcard__title">{SONG.title}</h2>
        <p className="jcard__for">{titleForName(name)}</p>
        <p className="jcard__kicker">{SONG.kicker}</p>

        <ol className="jcard__thumbs" aria-label="the day, printed small">
          {photos.slice(0, 6).map((photo, index) => (
            <li key={photo.src} className="jcard__thumb">
              <HalftonePhoto src={photo.src} alt={photo.alt} className="jcard__thumb-print" />
              <span className="jcard__note" aria-hidden="true">
                {photo.note ?? ""}
              </span>
              <span className="jcard__tape" aria-hidden="true" data-index={index % 3} />
            </li>
          ))}
        </ol>

        <ol className="jcard__lyrics">
          {SONG.lyrics.map((line, index) =>
            index < printed ? (
              <li
                key={line}
                data-active={playing && activeLine === index}
                data-past={playing && activeLine > index}
                style={{ ["--tilt" as string]: `${((index % 3) - 1) * 0.85}deg` }}
              >
                {line}
              </li>
            ) : (
              <li key={`blank-${line}`} className="jcard__blank" aria-hidden="true" />
            ),
          )}
        </ol>

        <footer className="jcard__foot">
          <span>{SONG.recorded}</span>
          <span className="jcard__date">{SONG.date}</span>
        </footer>
        <span className="jcard__closing">{SONG.closing}</span>
        <span className="jcard__dogear" aria-hidden="true" />
        <span className="jcard__smudge" aria-hidden="true" />
      </article>
    </section>
  );
}
