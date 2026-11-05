import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { getTape, type Health } from "../../lib/api";
import { asset, BASE, media } from "../../lib/env";
import type { Deck } from "../../lib/useDeck";
import { useRecorder } from "../../lib/useRecorder";
import type { Tape, TapeSummary } from "../../lib/types";
import { Floaters, type Floater } from "./Floaters";
import { day, readJournal } from "../../lib/journal";
import { ThemeIcon, useTheme } from "../../lib/theme";

/** how a day becomes a single: every model, in the order a release goes through it */
const CHAIN: { model: string; job: string; open?: boolean }[] = [
  { model: "Muse Spark 1.3", job: "looks at every photo and finds what the day was about" },
  { model: "SAM 3.1", job: "cuts the things in your photos out of them" },
  { model: "Muse Wonder 1.0", job: "calls the genre, casts the band, writes the song" },
  { model: "Muse Image 1.0", job: "dresses each thing as its band role, paints the sleeve" },
  { model: "ACE-Step 1.5 XL", job: "records four takes", open: true },
  { model: "Demucs", job: "splits the vocal out and cuts any take that drifts off key", open: true },
  { model: "Muse Voice Transcribe", job: "listens back and checks every line was actually sung" },
  { model: "MMS aligner", job: "times every word to the singing, to the 20 ms frame", open: true },
  { model: "Muse Spark 1.2", job: "hears the takes that are left and keeps one" },
  { model: "Muse Spark 1.3", job: "directs the video, shot by shot" },
];

const kept = (t: Tape) => t.takes?.find((k) => k.kept) ?? null;

type Props = { deck: Deck; shelf: TapeSummary[]; health: Health | null; online: boolean; onOpen: (id: string) => void };

export function Front({ deck, shelf, health, online, onOpen }: Props) {
  const { state, MIN, MAX } = deck;
  const { photos, name, note } = state;
  const input = useRef<HTMLInputElement>(null);
  const make = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  const rec = useRecorder((text) => deck.setNote(text, true));
  const [mine] = useState(readJournal);
  const theme = useTheme();

  // every release on the shelf, whole (the cards quote their real numbers)
  const [releases, setReleases] = useState<Tape[]>([]);
  const ids = shelf.map((t) => t.id).join(",");
  useEffect(() => {
    if (!ids) return;
    void Promise.all(ids.split(",").map((id) => getTape(id).catch(() => null))).then((ts) =>
      setReleases(ts.filter((t): t is Tape => Boolean(t?.cover))),
    );
  }, [ids]);

  // the things floating in the sky, each from one of those days
  const [things, setThings] = useState<Floater[]>([]);
  useEffect(() => {
    void fetch(asset("objects/objects.json"))
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Floater[]) => setThings(list))
      .catch(() => setThings([]));
  }, []);
  const floaters = useMemo(() => {
    const byId = new Map(releases.map((t) => [t.id, t]));
    // every thing floats; the ones whose day is on the shelf open its single
    const live = things.map((f) => {
      const t = f.tid ? byId.get(f.tid) : undefined;
      return t ? { ...f, name: t.name ?? "someone", genre: t.genre ?? "" } : { ...f, tid: undefined };
    });
    // alternate days so neighbours are never from the same one
    const days = [...new Set(live.map((f) => f.day))];
    const out: Floater[] = [];
    for (let round = 0; out.length < live.length; round++)
      for (const d of days) {
        const f = live.filter((x) => x.day === d)[round];
        if (f) out.push(f);
      }
    return out;
  }, [things, releases]);

  // the hero's one live line: whose day was which genre, cycling
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (releases.length < 2) return;
    const id = window.setInterval(() => setAt((a) => (a + 1) % releases.length), 4200);
    return () => window.clearInterval(id);
  }, [releases.length]);
  const now = releases.length ? releases[at % releases.length] : null;

  const toMake = useCallback(() => make.current?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (e.dataTransfer.files.length) {
        deck.addFiles(e.dataTransfer.files);
        toMake();
      }
    },
    [deck, toMake],
  );

  const ready = photos.length >= MIN && online;
  const bandAway = health?.ok && health.band === false;
  const status = !online ? "closed" : bandAway ? "warming" : "open";
  const micLabel =
    rec.state === "recording" ? "listening" : rec.state === "hearing" ? "writing it down" : rec.state === "denied" ? "mic blocked" : "hold to say it";
  // the release the studio replays from the front door: the first on the shelf that kept its takes
  const star = releases.find((t) => (t.takes?.length ?? 0) >= 2) ?? null;
  const demo = releases.find((t) => t.photos.some((p) => p.performer && p.cutout)) ?? null;
  const demoPhoto = demo?.photos.find((p) => p.performer && p.cutout) ?? null;

  return (
    <main
      className="fr"
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
      <nav className="fr__nav">
        <a className="fr__mark" href="#top">
          songbird
        </a>
        <div className="fr__links">
          <a href="#shelf">the shelf</a>
          <a href="#why">why songs</a>
          <a href="#how">how it works</a>
          <a href={`${BASE}log`}>the build log</a>
        </div>
        <div className="fr__right">
          <button
            className="fr__theme"
            onClick={theme.toggle}
            aria-label={theme.theme === "dark" ? "switch to day mode" : "switch to night mode"}
            title={theme.theme === "dark" ? "day mode" : "night mode"}
          >
            <ThemeIcon theme={theme.theme} />
          </button>
          <button className="fr__cta fr__cta--sm" onClick={toMake}>
            <i data-status={status} aria-hidden="true" />
            make yours
          </button>
        </div>
      </nav>

      {/* 1 · the sky: things from other people's days, each one a door into its single */}
      <section className="fr__hero" id="top">
        <div className="fr__sky" aria-hidden="true" style={{ backgroundImage: `url(${asset("sky.jpg")})` }} />
        <Floaters items={floaters} onOpen={onOpen} />
        <div className="fr__title">
          <h1 className="fr__word">songbird</h1>
          <p className="fr__hook">every day has a genre.</p>
          <p className="fr__sub">turn today's photos into a song about today, sung by the things in them.</p>
          <div className="fr__actions">
            <button className="fr__cta" onClick={toMake}>
              make today's single
            </button>
            <a className="fr__ghost" href="#shelf">
              hear one first
            </a>
            {star && (
              <button className="fr__ghost fr__ghost--studio" onClick={() => deck.replay(star)}>
                <i aria-hidden="true" />
                watch one get made
              </button>
            )}
          </div>
          {now && (
            <button key={now.id} className="fr__now" onClick={() => onOpen(now.id)}>
              <i aria-hidden="true" />
              {now.name ?? "someone"}'s day was <b>{now.genre}</b>
            </button>
          )}
        </div>
        <p className="fr__hint">every object up here came out of someone's photos. click one to hear its day.</p>
      </section>

      {/* 2 · the shelf: real releases, real numbers (and your own, first, if you've made any here) */}
      <section className="fr__shelf" id="shelf">
        {mine.length > 0 && (
          <div className="fr__mine">
            <header className="fr__head">
              <h2>your discography.</h2>
              <p>
                {mine.length} day{mine.length === 1 ? "" : "s"} on record, kept on this device.
              </p>
            </header>
            <ul className="fr__mine-row">
              {mine.map((e) => (
                <li key={e.id}>
                  <button className="fr__mine-item" onClick={() => onOpen(e.id)} title={`${e.title} · ${e.genre ?? ""}`}>
                    <span className="fr__mine-sleeve">{e.cover ? <img src={media(e.cover) ?? e.cover} alt="" loading="lazy" /> : <i />}</span>
                    <span className="fr__mine-day num">{day(e.at)}</span>
                    <b>{e.title}</b>
                    <span>{e.genre}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <header className="fr__head">
          <h2>this week on songbird.</h2>
          <p>
            {releases.length ? `${releases.length} days, ${releases.length} singles. ` : ""}every song, sleeve and video here was
            made by the pipeline you can run below.
          </p>
        </header>
        <ul className="fr__cards">
          {releases.map((t) => {
            const k = kept(t);
            return (
              <li key={t.id} className="fr__card-li">
                {(t.takes?.length ?? 0) >= 2 && (
                  <button className="fr__made" onClick={() => deck.replay(t)} title="replay this release's real session in the studio">
                    <i aria-hidden="true" />
                    watch it get made
                  </button>
                )}
                <button className="fr__card" onClick={() => onOpen(t.id)}>
                  <span className="fr__media">
                    {t.cover && <img src={t.cover} alt="" loading="lazy" />}
                    {t.genre && (
                      <span className="fr__pill">
                        <i />
                        {t.genre}
                      </span>
                    )}
                  </span>
                  <span className="fr__body">
                    <span className="fr__who">
                      {t.name ?? "someone"} <em className="num">{t.catalog}</em>
                    </span>
                    {t.note && <span className="fr__note">“{t.note}”</span>}
                    {(k?.bandKey ?? t.key) && <span className="fr__verdict">in {k?.bandKey ?? t.key}</span>}
                    <span className="fr__title-line">
                      <b>{t.title}</b>
                      <span className="fr__arrow" aria-hidden="true">
                        ↗
                      </span>
                    </span>
                    <span className="fr__roll" aria-hidden="true">
                      {t.photos.slice(0, 6).map((p, i) => (
                        <img key={i} src={p.src} alt="" loading="lazy" />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3 · why songs */}
      <section className="fr__why" id="why">
        <p className="fr__big">
          <span className="fr__dim">photos remember how it looked.</span>
          <span>songs remember how it felt.</span>
        </p>
        <div className="fr__manifesto">
          <p>
            we took more than two trillion photos last year<sup>1</sup>. most of them we will never open again.
          </p>
          <p>
            but you still know every word of a song you loved at fifteen. songs are how people have always kept things:
            memories brought back by music are more vivid than ones brought back by faces<sup>2</sup>.
          </p>
          <p>
            so songbird turns the day you just had into a song you'll want to play again. the things in your photos become
            the band. the day picks the genre. three minutes later it's on record, yours to keep and to send to whoever was
            there.
          </p>
          <p className="fr__sign">one day, one single. a year of them is your discography.</p>
        </div>
        <ol className="fr__refs">
          <li>PetaPixel, 2025: photos taken worldwide expected to pass two trillion.</li>
          <li>Belfi, Karlan &amp; Tranel, “Music evokes vivid autobiographical memories”, Memory 24(7), 2016.</li>
        </ol>
      </section>

      {/* 4 · how a day becomes a single, shown on one real release */}
      <section className="fr__how" id="how">
        <header className="fr__head">
          <h2>how a day becomes a single.</h2>
          <p>
            nine models, ten jobs. three of them run on open weights, on our own GPU.{" "}
            <a className="fr__loglink" href={`${BASE}log`}>
              how meta's models made songbird →
            </a>
          </p>
        </header>
        <div className="fr__studio">
          <video
            className="fr__studio-film"
            src={asset("studio/room.mp4")}
            poster={asset("studio/room.jpg")}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            aria-label="the studio making maya's single, sped up"
          />
          <div className="fr__studio-copy">
            <span className="fr__studio-kick">
              <i aria-hidden="true" />
              the studio
            </span>
            <p>
              every release is made in front of you. each lamp is a model, lit only while it works: the cut-outs land,
              the producer writes the sheet, four takes roll, the tuner throws out the off-key ones and the A&amp;R keeps
              one.
            </p>
            {star && (
              <button className="fr__cta" onClick={() => deck.replay(star)}>
                step inside: replay {star.name ?? "a"}'s session
              </button>
            )}
            <span className="fr__studio-fine">the real session, from what the release kept. 3× speed, clocks in real time.</span>
          </div>
        </div>
        {demo && demoPhoto && (
          <ol className="fr__steps">
            <li>
              <span className="fr__frame">
                <img src={demoPhoto.src} alt="" />
              </span>
              <b>your photo</b>
              <span className="fr__tag">{demoPhoto.hero}</span>
            </li>
            <li>
              <span className="fr__frame fr__frame--cut">
                <img src={demoPhoto.cutout ?? ""} alt="" />
              </span>
              <b>cut out</b>
              <span className="fr__tag">SAM 3.1</span>
            </li>
            <li>
              <span className="fr__frame fr__frame--cut">
                <img src={demoPhoto.performer ?? ""} alt="" />
              </span>
              <b>cast in the band</b>
              <span className="fr__tag">
                {demo.band?.find((b) => demo.photos[b.photo] === demoPhoto)?.role ?? "Muse Image 1.0"}
              </span>
            </li>
            <li>
              <span className="fr__frame">
                <img src={demo.cover ?? ""} alt="" />
              </span>
              <b>on record</b>
              <span className="fr__tag">{demo.genre}</span>
            </li>
          </ol>
        )}
        <ol className="fr__chain">
          {CHAIN.map((c, i) => (
            <li key={`${c.model}-${i}`}>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <b>{c.model}</b>
              <span>{c.job}</span>
              {c.open && <em>open weights</em>}
            </li>
          ))}
        </ol>
      </section>

      {/* 5 · your day */}
      <section
        className="fr__make"
        id="make"
        ref={make}
        aria-label="make today's single"
        style={{ ["--sky" as string]: `url(${asset("sky.jpg")})` }}
      >
        <div className="fr__desk">
          <header className="fr__desk-head">
            <h2>make today's single.</h2>
            <p>
              three to {MAX} photos from one day, or a three-second clip. no account. about three minutes.{" "}
              <button className="fr__link" onClick={() => void deck.addSample()}>
                or borrow someone's day
              </button>
            </p>
            {state.notice && <p className="fr__notice">{state.notice}</p>}
          </header>

          <ul className="fr__slots">
            {Array.from({ length: MAX }, (_, i) => {
              const p = photos[i];
              return (
                <li key={p?.key ?? `empty-${i}`} className="fr__slot" data-empty={!p}>
                  {p ? (
                    <>
                      {p.video ? <video src={p.src} muted playsInline loop autoPlay /> : <img src={p.src} alt={`photo ${i + 1}`} />}
                      {p.video && <span className="fr__clip">clip</span>}
                      <button className="fr__remove" onClick={() => deck.remove(p.key)} aria-label={`remove photo ${i + 1}`}>
                        ×
                      </button>
                    </>
                  ) : (
                    <button className="fr__add" onClick={() => input.current?.click()} aria-label="add photos">
                      {i === photos.length ? "+" : ""}
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

          <div className="fr__fields">
            <label className="fr__field">
              <span>whose day was it</span>
              <input value={name} maxLength={18} placeholder="your name" onChange={(e) => deck.setName(e.target.value)} />
            </label>
            <div className="fr__field">
              <label htmlFor="fr-note">one thing the photos can't show</label>
              <div className="fr__note-in">
                <input
                  id="fr-note"
                  value={note}
                  maxLength={160}
                  placeholder="i cried at the speech and again at the cake"
                  onChange={(e) => deck.setNote(e.target.value)}
                />
                {rec.supported && (
                  <button
                    className="fr__mic"
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

          <div className="fr__go">
            <button className="fr__cta fr__cta--lg" disabled={!ready} onClick={() => void deck.pull()}>
              <i data-status={status} aria-hidden="true" />
              {ready
                ? "produce my day"
                : online
                  ? `add ${MIN - photos.length} more photo${MIN - photos.length === 1 ? "" : "s"}`
                  : "the studio is closed"}
            </button>
            <span className="fr__status">
              {status === "open" ? "studio open" : status === "warming" ? "the band is warming up" : "studio closed · the shelf still plays"}
            </span>
          </div>
        </div>
      </section>

      <footer className="fr__foot">
        <span className="fr__mark">songbird</span>
        <span>your days, on record.</span>
        <a className="fr__loglink" href={`${BASE}log`}>
          the build log
        </a>
        <span className="fr__fine">
          the sample days on this page were photographed by Muse Image, so nobody's real photos are used. everything else
          (songs, bands, sleeves, videos) came out of the same pipeline as yours will.
        </span>
      </footer>
    </main>
  );
}
