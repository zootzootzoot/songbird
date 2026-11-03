import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BASE } from "../../lib/env";
import type { Player } from "../../lib/usePlayer";
import type { Tape } from "../../lib/types";
import { Backdrop, Fx } from "./Backdrop";
import { Lyrics } from "./Lyrics";
import { pulse } from "./motion";
import { Credits, Flash, LowerThird, TitleCard } from "./Overlays";
import { buildTimeline, cueAt, lastCueAt, members, type Member } from "./schedule";
import { Stage, type StageState } from "./Stage";
import { resolveTheme, useThemeFonts } from "./themes";
import { Transport } from "./Transport";
// core first, then the themes, regardless of who else imports video.css
import "../../styles/video.css";
import "./themes.css";

function useViewport() {
  const [vp, setVp] = useState(() => ({ W: window.innerWidth, H: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setR(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return r;
}

/** The result: the single's music video. See DESIGN.md "The video". */
export function Video({ tape, player, autoplay, onExit }: { tape: Tape; player: Player; autoplay: boolean; onExit: () => void }) {
  const theme = useMemo(() => resolveTheme(tape), [tape]);
  useThemeFonts(theme);
  const duration = player.duration || tape.duration || 1;
  const tl = useMemo(() => buildTimeline(tape, duration), [tape, duration]);
  const band = useMemo(() => members(tape), [tape]);
  const { W, H } = useViewport();
  const portrait = H > W * 1.05;
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement | null>(null);

  // the player resets to 0 when the song ends; hold the last frame and show the end card instead
  const [ended, setEnded] = useState(false);
  const prev = useRef({ t: 0, playing: false });
  useEffect(() => {
    const p = prev.current;
    if (p.playing && !player.playing && player.time === 0 && p.t > duration - 1.5) setEnded(true);
    prev.current = { t: player.time, playing: player.playing };
  }, [player.time, player.playing, duration]);

  const t = ended ? duration : player.time;
  const started = player.playing || player.time > 0 || ended;
  const bpm = tape.bpm > 30 ? tape.bpm : 100;
  const beats = (t * bpm) / 60;

  // what's on screen
  const { cues, titleEnd, creditsStart } = tl;
  const cur = cueAt(cues, t);
  const last = lastCueAt(cues, t);
  const finished = cur >= 0 ? cur - 1 : last;
  const out = finished >= 0 && t >= cues[finished].until && t < cues[finished].until + 0.45 ? finished : -1;
  const inTitle = t < titleEnd && !ended;
  const held = cur >= 0 ? cues[cur] : last >= 0 && t - cues[last].until < 2.5 ? cues[last] : null;
  const credits = t >= creditsStart;
  const verse = !inTitle && !credits && held && held.photo != null && !held.chorus;
  const mode: StageState["mode"] = inTitle ? "title" : verse ? "verse" : "lineup";
  const n = tape.photos.length;
  const solo = !inTitle && !held && !credits && n > 1 ? Math.floor(beats / 8) % n : null;
  const side: 0 | 1 = verse && held ? held.side : 0;
  const flash = !inTitle && held && held.photo != null ? held.photo : null;

  let intro: Member | null = null;
  if (!inTitle && !credits) {
    for (let j = last; j >= 0 && cues[j].start > t - 5; j -= 1) {
      const c = cues[j];
      if (c.intro && c.photo != null) {
        // introduce them while they are the one fronting, for at least a few seconds
        if (held && held.photo === c.photo && t < Math.max(c.until, c.start + 4.2)) intro = band[c.photo] ?? null;
        break;
      }
    }
  }

  const live = useRef<StageState>({ mode, front: null, side, solo, credits, t, bpm });
  live.current = { mode, front: verse && held ? held.photo : null, side, solo, credits, t, bpm };

  // per-frame beat values for CSS, written straight to the root
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ph = beats - Math.floor(beats);
    el.style.setProperty("--ph", ph.toFixed(3));
    el.style.setProperty("--pulse", (reduced ? 0.25 : pulse(beats)).toFixed(3));
    el.style.setProperty("--bph", ((beats / 4) % 1).toFixed(3));
    el.style.setProperty("--t", t.toFixed(3));
    const b = String(Math.floor(beats) % 8);
    if (el.dataset.beat !== b) el.dataset.beat = b;
  });

  // autoplay: only when the page has had a gesture, otherwise the big play button does it
  const playRef = useRef(player.play);
  playRef.current = player.play;
  useEffect(() => {
    if (!autoplay) return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    const id = window.setTimeout(() => void playRef.current(), 900);
    return () => window.clearTimeout(id);
  }, [autoplay]);

  const toggle = useCallback(() => {
    if (player.playing) player.stop();
    else {
      setEnded(false);
      void player.play();
    }
  }, [player]);

  const seek = useCallback(
    (x: number) => {
      setEnded(false);
      player.seek(x);
    },
    [player],
  );

  // transport visibility
  const [awake, setAwake] = useState(true);
  const idle = useRef(0);
  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setAwake(false), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(idle.current), []);
  const show = awake || !player.playing;

  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const [copied, setCopied] = useState(false);
  const share = useCallback(async () => {
    const link = `${location.origin}${BASE}?tape=${encodeURIComponent(tape.id)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [tape.id]);

  // keyboard: space toggles, arrows seek, F fullscreen
  const keys = useRef({ toggle, seek, toggleFull, wake, t: player.time, duration });
  keys.current = { toggle, seek, toggleFull, wake, t: player.time, duration };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = keys.current;
      if (e.key === " " || e.code === "Space") {
        if (el?.tagName === "BUTTON") return;
        e.preventDefault();
        k.toggle();
        k.wake();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const d = (e.shiftKey ? 15 : 5) * (e.key === "ArrowRight" ? 1 : -1);
        k.seek(Math.max(0, Math.min(k.duration - 0.1, k.t + d)));
        k.wake();
      } else if (e.key === "f" || e.key === "F") {
        k.toggleFull();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const creditsProgress = (t - creditsStart) / Math.max(1, duration - creditsStart);
  const rootStyle = { "--beat": `${(60 / bpm).toFixed(4)}s`, "--bar": `${((240 / bpm)).toFixed(4)}s` } as CSSProperties;

  return (
    <main
      ref={root}
      className={`video vt-${theme.family} vv-${theme.variant}`}
      style={rootStyle}
      data-mode={mode}
      data-side={side}
      data-credits={credits ? 1 : 0}
      data-chorus={held?.chorus ? 1 : 0}
      data-playing={player.playing ? 1 : 0}
      data-started={started ? 1 : 0}
      data-portrait={portrait ? 1 : 0}
      data-flash={flash != null ? 1 : 0}
      data-idle={show ? 0 : 1}
      data-reduced={reduced ? 1 : 0}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake();
        if (e.pointerType === "mouse" && started && e.button === 0) toggle();
      }}
    >
      <div className="video-world">
        <Backdrop theme={theme} tape={tape} />
        <Flash tape={tape} theme={theme} photo={flash} />
        <Stage tape={tape} theme={theme} live={live} W={W} H={H} reduced={reduced} />
        {(started || !inTitle) && (
          <Lyrics cues={cues} cur={cur} out={out} t={t} theme={theme} layout={`${mode}:${side}:${credits ? 1 : 0}:${W}x${H}`} />
        )}
        <LowerThird member={intro} side={side} theme={theme} />
        <Credits tape={tape} band={band} on={credits && !ended} progress={creditsProgress} theme={theme} />
        <TitleCard tape={tape} theme={theme} on={inTitle} />
        <Fx theme={theme} />
      </div>

      <div className="vwm" aria-hidden="true">
        <span className="wordmark">Songbird</span>
        <i className="vwm-dot" />
        <span className="num">{tape.catalog}</span>
      </div>

      {!started && (
        <button
          className="vplay"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
            wake();
          }}
          aria-label="Play the video"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
          </svg>
          <span className="label">Play</span>
        </button>
      )}

      {ended && (
        <div className="vend" onPointerDown={(e) => e.stopPropagation()}>
          <div className="vend-cat num">{tape.catalog}</div>
          <div className="vend-title">{tape.title}</div>
          {tape.artist && <div className="vend-artist">{tape.artist}</div>}
          <div className="vend-actions">
            <button className="vend-btn is-primary" onClick={toggle}>
              <span className="label">Play again</span>
            </button>
            <button className="vend-btn" onClick={() => void share()}>
              <span className="label">{copied ? "Link copied" : "Copy link"}</span>
            </button>
            <button className="vend-btn" onClick={onExit}>
              <span className="label">Back to the studio</span>
            </button>
          </div>
        </div>
      )}

      <div onPointerDown={(e) => e.stopPropagation()}>
        <Transport
          show={show}
          playing={player.playing}
          silent={player.silent}
          time={t}
          duration={duration}
          cues={cues}
          full={full}
          copied={copied}
          onToggle={toggle}
          onSeek={seek}
          onFull={toggleFull}
          onShare={() => void share()}
          onExit={onExit}
        />
      </div>
    </main>
  );
}
