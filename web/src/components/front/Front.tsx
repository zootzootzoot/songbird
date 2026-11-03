import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { getTape, type Health } from "../../lib/api";
import type { Deck } from "../../lib/useDeck";
import { useRecorder } from "../../lib/useRecorder";
import type { Tape, TapeSummary } from "../../lib/types";

/** the signal chain, in the order a release goes through it */
const CHAIN: { model: string; job: string; open?: boolean }[] = [
  { model: "Muse Spark 1.3", job: "looks" },
  { model: "SAM 3.1", job: "casts the band" },
  { model: "Muse Wonder 1.0", job: "produces" },
  { model: "ACE-Step 1.5 XL", job: "records four takes", open: true },
  { model: "Demucs", job: "tunes", open: true },
  { model: "Muse Spark 1.2", job: "keeps one" },
  { model: "Muse Image 1.0", job: "paints the sleeve" },
];

const pad = (n: number) => String(n).padStart(2, "0");

type Props = { deck: Deck; shelf: TapeSummary[]; health: Health | null; online: boolean; onOpen: (id: string) => void };

export function Front({ deck, shelf, health, online, onOpen }: Props) {
  const { state, MIN, MAX } = deck;
  const { photos, name, note } = state;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const rec = useRecorder((text) => deck.setNote(text, true));

  // one real release, shown whole: what went in, what the producer decided, what came out
  const [specimen, setSpecimen] = useState<Tape | null>(null);
  const firstId = shelf[0]?.id;
  useEffect(() => {
    if (firstId) void getTape(firstId).then(setSpecimen);
  }, [firstId]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (e.dataTransfer.files.length) deck.addFiles(e.dataTransfer.files);
    },
    [deck],
  );

  const ready = photos.length >= MIN && online;
  const bandAway = health?.ok && health.band === false;
  const status = !online ? "closed" : bandAway ? "warming" : "open";
  const micLabel =
    rec.state === "recording" ? "listening" : rec.state === "hearing" ? "writing it down" : rec.state === "denied" ? "mic blocked" : "hold to say it";
  const cast = specimen ? specimen.photos.map((p, i) => ({ p, i })).filter(({ p }) => p.cutout).slice(0, 4) : [];

  return (
    <main className="front">
      <header className="front__strip">
        <span className="wordmark front__mark">Songbird</span>
        <span className="front__status label" data-status={status}>
          <b aria-hidden="true" />
          {status === "open" ? "studio open" : status === "warming" ? "the band is warming up" : "studio closed · the catalogue still plays"}
        </span>
      </header>

      <section className="front__pitch">
        <h1 className="front__headline">
          Every day has a genre.
          <span>Songbird finds yours.</span>
        </h1>
        <p className="front__lede">
          Give it a few photos from one day. A producer with very strong opinions calls the genre, casts what's in them
          as the band, records the single and cuts the video.
        </p>

        {specimen && (
          <figure className="front__specimen">
            <figcaption className="label">
              how <span className="num">{specimen.catalog}</span> was made
            </figcaption>
            <div className="front__flow">
              <span className="front__step label">the photos, cast as the band · SAM 3.1</span>
              <span className="front__step label">the call · Muse Wonder 1.0</span>
              <span className="front__step label">the single · ACE-Step XL, Muse Image</span>
              <ol className="front__cast" aria-label="the band, cut out of the photos">
                {cast.map(({ p, i }) => (
                  <li key={i}>
                    <img className="front__cast-photo" src={p.src} alt="" />
                    <img className="front__cast-cut" src={p.cutout ?? ""} alt={p.hero} />
                    <span>{p.hero}</span>
                  </li>
                ))}
              </ol>
              <blockquote className="front__call">
                <p className="front__genre-call">{specimen.genre}</p>
                <p className="front__why">“{specimen.why}”</p>
              </blockquote>
              <button className="front__sleeve-big" onClick={() => onOpen(specimen.id)} aria-label={`play ${specimen.title}`}>
                {specimen.cover && <img src={specimen.cover} alt="" />}
                <span className="front__play">
                  <i aria-hidden="true" />
                  {specimen.title}
                </span>
              </button>
            </div>
          </figure>
        )}

        <ol className="front__chain" aria-label="signal chain">
          {CHAIN.map((c, i) => (
            <li key={c.model}>
              <span className="num">{pad(i + 1)}</span>
              <b>{c.model}</b>
              <span>
                {c.job}
                {c.open && <em> · open weights</em>}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="front__input"
        data-over={over}
        aria-label="your day"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="front__input-head">
          <h2>Your day</h2>
          <span className="num front__count">
            {photos.length} of {MAX}
          </span>
        </div>

        <ul className="front__channels">
          {Array.from({ length: MAX }, (_, i) => {
            const p = photos[i];
            return (
              <li key={p?.key ?? `empty-${i}`} className="front__ch" data-empty={!p}>
                {p ? (
                  <>
                    {p.video ? (
                      <video src={p.src} muted playsInline loop autoPlay />
                    ) : (
                      <img src={p.src} alt={`photo ${i + 1}`} />
                    )}
                    {p.video && <span className="front__clip label">clip</span>}
                    <button className="front__remove" onClick={() => deck.remove(p.key)} aria-label={`remove photo ${i + 1}`}>
                      ×
                    </button>
                  </>
                ) : (
                  <button className="front__add" onClick={() => input.current?.click()} aria-label="add photos">
                    <span className="num">{pad(i + 1)}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <input
          ref={input}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) deck.addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="front__sources">
          Drop in photos or a three-second clip, or{" "}
          <button className="front__link" onClick={deck.addSample}>
            borrow a sample day
          </button>
          .
        </p>
        {state.notice && <p className="front__notice">{state.notice}</p>}

        <label className="front__field">
          <span className="label">who's the star</span>
          <input value={name} maxLength={24} placeholder="ada" onChange={(e) => deck.setName(e.target.value)} />
        </label>
        <div className="front__field">
          <label htmlFor="front-note" className="label">
            one thing the photos can't show
          </label>
          <div className="front__note">
            <input
              id="front-note"
              value={note}
              maxLength={160}
              placeholder="she named the pigeon gerald"
              onChange={(e) => deck.setNote(e.target.value)}
            />
            {rec.supported && (
              <button
                className="front__mic"
                data-state={rec.state}
                style={{ ["--level" as string]: rec.level }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  void rec.start();
                }}
                onPointerUp={rec.stop}
                onPointerLeave={() => rec.state === "recording" && rec.stop()}
                aria-label="hold to say it; Muse Voice Transcribe writes it down"
              >
                {micLabel}
              </button>
            )}
          </div>
        </div>

        <button className="front__rec" disabled={!ready} onClick={() => void deck.pull()}>
          <i aria-hidden="true" />
          <span>{ready ? "Produce my day" : online ? `Add ${MIN - photos.length} more photo${MIN - photos.length === 1 ? "" : "s"}` : "The studio is closed"}</span>
          {ready && <em className="num">about 2 min</em>}
        </button>
      </section>

      <section className="front__catalogue" aria-label="catalogue">
        <div className="front__cat-head">
          <span className="label">recently released</span>
        </div>
        <ul>
          {shelf.map((t) => (
            <li key={t.id}>
              <button className="front__release" onClick={() => onOpen(t.id)} title={`${t.title} · ${t.genre}`}>
                <span className="front__sleeve">{t.cover ? <img src={t.cover} alt="" loading="lazy" /> : <i />}</span>
                <span className="front__rel-text">
                  <b>{t.title}</b>
                  <span>{t.genre}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
