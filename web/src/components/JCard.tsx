import { useState, type CSSProperties } from "react";
import { formatTime } from "../lib/copy";
import type { Tape } from "../lib/types";
import { tapeUrl } from "../lib/useDeck";
import { Cover, CoverTitle, HeroCrop } from "./Cover";

/** the lyric sheet, grouped by section, in sung order with repeats folded */
export function sections(tape: Tape) {
  const out: { name: string; lines: { text: string; index: number; photo: number | null }[] }[] = [];
  const seen = new Set<string>();
  let skipping = "";
  tape.lines.forEach((l, index) => {
    const name = (l.section || (l.kind === "chorus" ? "chorus" : "")).toLowerCase();
    if (skipping && name === skipping) return;
    skipping = "";
    const last = out[out.length - 1];
    if (last && last.name === name) {
      last.lines.push({ text: l.text, index, photo: l.photo });
      return;
    }
    if (name && seen.has(name) && /chorus|hook|refrain/.test(name)) {
      out.push({ name: `${name} (again)`, lines: [] });
      skipping = name;
      return;
    }
    seen.add(name);
    out.push({ name, lines: [{ text: l.text, index, photo: l.photo }] });
  });
  return out.filter((s) => s.lines.length || /again/.test(s.name));
}

export function Band({ tape }: { tape: Tape }) {
  const band = tape.band?.length ? tape.band : tape.photos.map((p, i) => ({ photo: i, role: p.hero }));
  return (
    <ul className="band">
      {band.map((b, i) => {
        const p = tape.photos[b.photo];
        if (!p) return null;
        const art = p.motion || p.cutout;
        return (
          <li key={i} style={{ ["--r" as string]: `${[-5, 4, -2, 6, -4, 3][i % 6]}deg` } as CSSProperties}>
            <span className="band__sticker">
              {art ? <img src={art} alt="" data-moving={Boolean(p.motion)} /> : <HeroCrop src={p.src} box={p.box} />}
            </span>
            <span className="band__credit">
              <b>{p.hero}</b>
              <i>{b.role}</i>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** the inside of the J-card: band, words, notes, takes, and who made what */
export function JCardInside({ tape, activeLine = -1, onSeek }: { tape: Tape; activeLine?: number; onSeek?: (t: number) => void }) {
  return (
    <div className="inside">
      <header className="inside__head">
        <span>{tape.catalog ?? "songbird records"}</span>
        <span>
          {formatTime(tape.duration)} · {Math.round(tape.bpm)} bpm · {tape.key.toLowerCase()}
        </span>
      </header>
      {tape.genre && <p className="inside__genre">{tape.genre}</p>}

      <section className="inside__block">
        <h3>the band</h3>
        <Band tape={tape} />
      </section>

      <section className="inside__block">
        <h3>the words</h3>
        <div className="inside__sheet">
          {sections(tape).map((s, i) => (
            <div key={i} className="inside__section">
              {s.name && <span className="inside__section-name">{s.name}</span>}
              {s.lines.map((l) => (
                <button
                  key={l.index}
                  type="button"
                  className="inside__line"
                  data-active={activeLine >= 0 && tape.lines[activeLine]?.text === l.text}
                  onClick={() => onSeek?.(tape.lines[l.index].start)}
                  tabIndex={onSeek ? 0 : -1}
                  aria-label={`play from: ${l.text}`}
                >
                  {l.text}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="inside__block liner">
        <h3>liner notes</h3>
        <p className="liner__note">{tape.liner}</p>
        {tape.note && (
          <p className="liner__told">
            <span>you told the producer</span> {tape.note}
          </p>
        )}
        {tape.caption && (
          <p className="liner__session">
            <span>session notes</span> {tape.caption}
          </p>
        )}
        {tape.takes && tape.takes.length > 0 && (
          <ul className="liner__takes">
            {tape.takes.map((t, i) => (
              <li key={i} data-kept={t.kept}>
                <span>take {i + 1}</span>
                <span>{t.cut ? (t.inKey != null ? `${Math.round(t.inKey * 100)}% in key` : "—") : t.score.toFixed(1)}</span>
                <span>{t.kept ? "kept" : t.cut ? "off key" : "rejected"}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="liner__credits">
          {tape.credits.map((c, i) => (
            <div key={i}>
              <dt>{c.role}</dt>
              <dd>{c.model}</dd>
            </div>
          ))}
        </dl>
        <p className="liner__colophon">
          recorded at the kitchen table. {tape.catalog ? `${tape.catalog}. ` : ""}songbird records.
        </p>
      </section>
    </div>
  );
}

/**
 * The release: a J-card in its case. The cover, and on the back of the same
 * card the band, the words and the liner notes. Below it, what you do with a
 * finished tape: open it, send it, keep it, print it.
 */
export function JCard({
  tape,
  activeLine,
  onSeek,
  onPrint,
}: {
  tape: Tape;
  activeLine: number;
  onSeek: (t: number) => void;
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<"" | "copied" | "sent">("");
  const shareable = !tape.id.startsWith("t_mock");

  const send = async () => {
    const url = tapeUrl(tape.id);
    const data = { title: tape.title, text: `${tape.artist ?? "songbird records"}, "${tape.title}". ${tape.catalog ?? ""}`.trim(), url };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
        setSent("sent");
      } else {
        await navigator.clipboard.writeText(url);
        setSent("copied");
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setSent("copied");
      } catch {
        window.prompt("the link to this release", url);
      }
    }
    window.setTimeout(() => setSent(""), 2200);
  };

  const keep = async () => {
    const name = `${tape.catalog ?? "songbird"} ${tape.title}`.replace(/[^a-z0-9 -]/gi, "").trim().replace(/\s+/g, "-") + ".mp3";
    try {
      const res = await fetch(tape.audio);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      window.open(tape.audio, "_blank", "noopener");
    }
  };

  return (
    <section className="jcard" aria-label={`the release: ${tape.title}`}>
      <div className="jcard__stage">
        <div className="jcard__card" data-open={open}>
          <div className="jcard__face jcard__face--front" aria-hidden={open}>
            <Cover tape={tape} className="jcard__cover" />
            <CoverTitle tape={tape} />
            <span className="jcard__case" aria-hidden="true" />
          </div>
          <div className="jcard__face jcard__face--back" aria-hidden={!open}>
            <JCardInside tape={tape} activeLine={activeLine} onSeek={open ? onSeek : undefined} />
            <span className="jcard__case" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="jcard__actions">
        <button type="button" className="act" onClick={() => setOpen((v) => !v)} aria-pressed={open}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h6v10H3zM11 5h6v10h-6z" />
          </svg>
          {open ? "close the sleeve" : "open the sleeve"}
        </button>
        {shareable && (
          <button type="button" className="act act--primary" onClick={send}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 10l14-6-5 14-2.5-5.5z" />
            </svg>
            send this tape
            {sent && (
              <span className="act__stamp" role="status">
                {sent === "copied" ? "link copied" : "sent"}
              </span>
            )}
          </button>
        )}
        {tape.audio && (
          <button type="button" className="act" onClick={keep}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v10M5.5 9l4.5 4.5L14.5 9M4 16.5h12" />
            </svg>
            keep the song
          </button>
        )}
        <button type="button" className="act" onClick={onPrint}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 7V3h9v4M5 14H3.5V8h13v6H15M6 11.5h8V17H6z" />
          </svg>
          print the j-card
        </button>
      </div>
    </section>
  );
}
