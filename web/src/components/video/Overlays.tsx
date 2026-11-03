import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Tape } from "../../lib/types";
import { Pixel } from "./Pixel";
import type { Member } from "./schedule";
import type { Theme } from "./themes";

const v = (o: Record<string, string | number>) => o as CSSProperties;

function Words({ text, cls }: { text: string; cls: string }) {
  return (
    <>
      {text.split(/\s+/).map((w, i) => (
        <span key={i} className={cls} style={v({ "--i": i })}>
          {w}{" "}
        </span>
      ))}
    </>
  );
}

/** 1. Title card until the first sung line. */
export const TitleCard = memo(function TitleCard({ tape, theme, on }: { tape: Tape; theme: Theme; on: boolean }) {
  const cover = tape.cover || tape.photos[0]?.src || null;
  return (
    <section className="vtc" data-on={on ? 1 : 0} aria-hidden={!on}>
      <div className="vtc-in">
        {cover && (
          <div className="vtc-cover">
            {theme.pixel ? <Pixel src={cover} rows={96} levels={6} className="vtc-px" /> : <img src={cover} alt="" decoding="async" />}
          </div>
        )}
        <div className="vtc-text">
          <div className="vtc-cat num">{tape.catalog ?? "SB"}</div>
          <h1 className="vtc-title">
            <Words text={tape.title} cls="tw" />
          </h1>
          {tape.artist && <div className="vtc-artist">{tape.artist}</div>}
          {tape.genre && <div className="vtc-genre">{tape.genre}</div>}
          <div className="vtc-meta num">
            <span>{Math.round(tape.bpm)} BPM</span>
            <span>{tape.key}</span>
          </div>
        </div>
      </div>
    </section>
  );
});

/** 3. Photo flashes: the line's photo full-bleed behind the band, treated by the theme. */
export const Flash = memo(function Flash({ tape, theme, photo }: { tape: Tape; theme: Theme; photo: number | null }) {
  return (
    <div className="vf" data-on={photo != null ? 1 : 0} aria-hidden="true">
      {tape.photos.map((p, i) => (
        <div key={i} className="vf-ph" data-on={photo === i ? 1 : 0}>
          {theme.pixel ? (
            <Pixel src={p.src} rows={96} levels={6} className="vf-img vf-px" />
          ) : p.clip ? (
            <video className="vf-img" src={p.clip} poster={p.src} muted loop playsInline autoPlay preload="auto" />
          ) : (
            <img className="vf-img" src={p.src} alt="" decoding="async" />
          )}
          <div className="vf-tint" />
        </div>
      ))}
      {photo != null && <div key={`hit${photo}`} className="vf-hit" />}
    </div>
  );
});

/** 5. Lower third, the first time a member fronts a line. */
export const LowerThird = memo(function LowerThird({ member, side, theme }: { member: Member | null; side: 0 | 1; theme: Theme }) {
  return (
    <div className="vlt" data-on={member ? 1 : 0} data-side={side}>
      {member && (
        <div className="vlt-in" key={member.photo}>
          <div className="vlt-kicker">introducing</div>
          <div className="vlt-name">
            {theme.family === "bit" ? `a wild ${member.name.replace(/^the\s+/i, "")} joins the band!` : member.name}
          </div>
          {member.role && <div className="vlt-role">{member.role}</div>}
        </div>
      )}
    </div>
  );
});

/** 6. Credits roll: the band, then the models. Scrolled by the song clock, so scrubbing works. */
export function Credits({
  tape,
  band,
  on,
  progress,
  theme,
}: {
  tape: Tape;
  band: Member[];
  on: boolean;
  progress: number;
  theme: Theme;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const roll = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ box: 800, roll: 1600 });
  useLayoutEffect(() => {
    const measure = () => {
      if (box.current && roll.current) setSize({ box: box.current.clientHeight, roll: roll.current.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (roll.current) ro.observe(roll.current);
    return () => ro.disconnect();
  }, []);
  const p = Math.max(0, Math.min(1, progress));
  const from = size.box;
  const to = size.box * 0.5 - size.roll;
  const y = from + (to - from) * p;
  return (
    <aside className="vc" data-on={on ? 1 : 0} ref={box} aria-hidden={!on}>
      <div className="vc-roll" ref={roll} style={{ transform: `translate3d(0, ${y.toFixed(1)}px, 0)` }}>
        <div className="vc-h">the band</div>
        {band.map((m) => {
          const ph = tape.photos[m.photo];
          const art = ph?.performer || ph?.motion || ph?.cutout;
          return (
            <div className="vc-row" key={m.photo}>
              <div className="vc-thumb">
                {art ? theme.pixel ? <Pixel src={art} rows={24} levels={5} /> : <img src={art} alt="" decoding="async" /> : null}
              </div>
              <div className="vc-who">
                <div className="vc-name">{m.name}</div>
                {m.role && <div className="vc-role">{m.role}</div>}
              </div>
            </div>
          );
        })}
        {tape.credits.length > 0 && <div className="vc-h">in the studio</div>}
        {tape.credits.map((c, i) => (
          <div className="vc-row vc-model" key={i}>
            <div className="vc-who">
              <div className="vc-role">{c.role}</div>
              <div className="vc-name">{c.model}</div>
            </div>
          </div>
        ))}
        <div className="vc-end">
          <div className="vc-cat num">{tape.catalog}</div>
          <div className="vc-title">{tape.title}</div>
          {tape.artist && <div className="vc-role">{tape.artist}</div>}
          <div className="vc-mark wordmark">Songbird</div>
        </div>
      </div>
    </aside>
  );
}
