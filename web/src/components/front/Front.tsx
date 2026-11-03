import { useCallback, useRef, useState, type DragEvent } from "react";
import type { Health } from "../../lib/api";
import type { Deck } from "../../lib/useDeck";
import { useRecorder } from "../../lib/useRecorder";
import type { TapeSummary } from "../../lib/types";

/** the signal chain, in the order a release goes through it */
const CHAIN: { model: string; job: string; open?: boolean }[] = [
  { model: "Muse Spark 1.3", job: "looks at the day" },
  { model: "SAM 3.1", job: "cuts out the band" },
  { model: "Muse Wonder 1.0", job: "produces, writes" },
  { model: "ACE-Step 1.5 XL", job: "records 4 takes", open: true },
  { model: "Demucs", job: "tunes, cuts off-key takes", open: true },
  { model: "Muse Spark 1.2", job: "listens back, keeps one" },
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
    rec.state === "recording" ? "listening" : rec.state === "hearing" ? "voice transcribe" : rec.state === "denied" ? "mic blocked" : "hold to talk";

  return (
    <main className="front">
      <header className="front__strip">
        <span className="wordmark front__mark">
          Songbird<i aria-hidden="true" />
        </span>
        <span className="front__status label" data-status={status}>
          <b aria-hidden="true" />
          {status === "open" ? "studio open" : status === "warming" ? "band warming up" : "studio closed, the catalogue still plays"}
        </span>
      </header>

      <section className="front__pitch">
        <h1 className="front__headline">
          Your day,
          <br />
          produced.
        </h1>
        <p className="front__lede">
          Give Songbird three to six photos from one day. Its producer has enormous opinions: it calls the genre, casts
          the things in your photos as the band, writes the single, records four takes, bins the off-key ones and cuts
          the music video.
        </p>
        {shelf.some((t) => t.genre) && (
          <div className="front__ticker" aria-label="the producer's recent calls">
            <span className="label">lately the producer called</span>
            <div className="front__ticker-track">
              {[0, 1].map((copy) => (
                <p key={copy} aria-hidden={copy === 1}>
                  {shelf
                    .filter((t) => t.genre)
                    .map((t) => (
                      <span key={t.id}>
                        {t.genre}
                        <i aria-hidden="true">/</i>
                      </span>
                    ))}
                </p>
              ))}
            </div>
          </div>
        )}
        <ol className="front__chain" aria-label="signal chain">
          {CHAIN.map((c, i) => (
            <li key={c.model}>
              <span className="num">{pad(i + 1)}</span>
              <b>{c.model}</b>
              <span>{c.job}</span>
              {c.open && <em className="label">open weights</em>}
            </li>
          ))}
        </ol>
      </section>

      <section
        className="front__input"
        data-over={over}
        aria-label="inputs"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="front__input-head">
          <span className="label">inputs</span>
          <span className="num front__count">
            {photos.length}/{MAX}
          </span>
        </div>

        <ul className="front__channels">
          {Array.from({ length: MAX }, (_, i) => {
            const p = photos[i];
            return (
              <li key={p?.key ?? `empty-${i}`} className="front__ch" data-empty={!p}>
                <span className="front__ch-no num">CH {pad(i + 1)}</span>
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
                    +
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
        <div className="front__sources">
          <button className="front__link" onClick={() => input.current?.click()}>
            add photos or a 3-second clip
          </button>
          <span aria-hidden="true">/</span>
          <button className="front__link" onClick={deck.addSample}>
            use the sample day
          </button>
        </div>
        {state.notice && <p className="front__notice">{state.notice}</p>}

        <label className="front__field">
          <span className="label">the star</span>
          <input value={name} maxLength={24} placeholder="ada" onChange={(e) => deck.setName(e.target.value)} />
        </label>
        <div className="front__field front__field--note">
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
                <span className="label">{micLabel}</span>
              </button>
            )}
          </div>
        </div>

        <button className="front__rec" disabled={!ready} onClick={() => void deck.pull()}>
          <i aria-hidden="true" />
          <span>{ready ? "record the single" : online ? `add ${MIN - photos.length} more` : "studio closed"}</span>
          <em className="num">{ready ? "~2:00" : `${photos.length}/${MIN}`}</em>
        </button>
      </section>

      <section className="front__catalogue" aria-label="catalogue">
        <div className="front__cat-head">
          <span className="label">the catalogue</span>
          <span className="label">{shelf.length} releases</span>
        </div>
        <ul>
          {shelf.map((t) => (
            <li key={t.id}>
              <button className="front__release" onClick={() => onOpen(t.id)}>
                <span className="front__sleeve">{t.cover ? <img src={t.cover} alt="" loading="lazy" /> : <i />}</span>
                <span className="num front__cat-no">{t.catalog ?? t.id}</span>
                <b>{t.title}</b>
                <span className="front__genre">{t.genre}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
