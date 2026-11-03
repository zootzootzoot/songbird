import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { getTape, type Health } from "../../lib/api";
import type { Deck } from "../../lib/useDeck";
import { useRecorder } from "../../lib/useRecorder";
import type { Tape, TapeSummary } from "../../lib/types";
import { Record } from "./Record";

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

const ROTATE_MS = 7000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "ada's tuesday 3 november" -> "Ada's Tuesday" */
function whose(t: Tape): string {
  const m = t.dedication.match(/^(.*?'s )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (!m) return "This day";
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return `${m[1] ? cap(m[1]) : "This "}${cap(m[2])}`;
}

type Props = { deck: Deck; shelf: TapeSummary[]; health: Health | null; online: boolean; onOpen: (id: string) => void };

export function Front({ deck, shelf, health, online, onOpen }: Props) {
  const { state, MIN, MAX } = deck;
  const { photos, name, note } = state;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const rec = useRecorder((text) => deck.setNote(text, true));

  // the hero cycles through real releases, whole
  const [releases, setReleases] = useState<Tape[]>([]);
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const ids = shelf.slice(0, 5).map((t) => t.id).join(",");
  useEffect(() => {
    if (!ids) return;
    void Promise.all(ids.split(",").map((id) => getTape(id))).then((ts) =>
      setReleases(ts.filter((t): t is Tape => Boolean(t?.cover))),
    );
  }, [ids]);
  useEffect(() => {
    if (releases.length < 2 || held) return;
    const id = window.setInterval(() => setAt((a) => (a + 1) % releases.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [releases.length, held]);
  const hero = releases[at % Math.max(1, releases.length)] ?? null;

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

  return (
    <main
      className="front"
      data-over={over}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="front__strip">
        <span className="wordmark front__mark">Songbird</span>
        <span className="front__status label" data-status={status}>
          <b aria-hidden="true" />
          {status === "open" ? "studio open" : status === "warming" ? "the band is warming up" : "studio closed · the catalogue still plays"}
        </span>
      </header>

      <section className="front__pitch">
        <h1 className="front__headline">Every day has a genre.</h1>
        <p className="front__verdict" aria-live="polite">
          {hero ? (
            <span key={hero.id} className="front__verdict-line">
              {whose(hero)} was <b>{hero.genre}</b>.
            </span>
          ) : (
            <span className="front__verdict-line">Songbird finds yours.</span>
          )}
        </p>
        {hero?.why && (
          <p key={`why-${hero.id}`} className="front__why">
            <span className="label">the producer</span> “{hero.why}”
          </p>
        )}
        <p className="front__lede">
          Give it a few photos from one day. A producer with very strong opinions calls the genre, casts what's in them
          as the band, records the single and cuts the video.
        </p>
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

      <section className="front__stage" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
        {hero && <Record key={hero.id} tape={hero} onOpen={() => onOpen(hero.id)} />}
        {releases.length > 1 && (
          <div className="front__dots" role="tablist" aria-label="releases">
            {releases.map((r, i) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={i === at % releases.length}
                aria-label={`${r.catalog} ${r.title}`}
                onClick={() => setAt(i)}
              >
                <span className="num">{r.catalog?.replace("SB-", "")}</span>
              </button>
            ))}
          </div>
        )}
        {hero && (
          <p className="front__caption">
            <span className="num">{hero.catalog}</span> {hero.title}
            {hero.artist && !hero.artist.includes("small days") && <span> · {hero.artist}</span>}
          </p>
        )}
      </section>

      <section className="front__dock" aria-label="your day">
        <div className="front__dock-head">
          <h2>Your day</h2>
          <p>
            Drop in 3 to {MAX} photos or a three-second clip, or{" "}
            <button className="front__link" onClick={deck.addSample}>
              borrow a sample day
            </button>
            .
          </p>
          {state.notice && <p className="front__notice">{state.notice}</p>}
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
                    {i === photos.length ? "+" : <span className="num">{pad(i + 1)}</span>}
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

        <div className="front__fields">
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
        </div>

        <button className="front__rec" disabled={!ready} onClick={() => void deck.pull()}>
          <i aria-hidden="true" />
          <span>
            {ready
              ? "Produce my day"
              : online
                ? `Add ${MIN - photos.length} more photo${MIN - photos.length === 1 ? "" : "s"}`
                : "The studio is closed"}
          </span>
          {ready && <em className="num">about 2 min</em>}
        </button>
      </section>

      <section className="front__catalogue" aria-label="catalogue">
        <span className="label">recently released</span>
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
