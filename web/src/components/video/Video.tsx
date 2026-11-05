import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { BASE, RENDER, RENDER_AT } from "../../lib/env";
import type { Player } from "../../lib/usePlayer";
import { useShareVideo } from "../../lib/useShareVideo";
import type { Tape } from "../../lib/types";
import { Backdrop, Fx } from "./Backdrop";
import { Lyrics } from "./Lyrics";
import { pulse } from "./motion";
import { freezeHold, plan, SINGLE, takeAt } from "./direct";
import { Credits, Flash, LowerThird, TitleCard } from "./Overlays";
import {
  buildTimeline,
  cueAt,
  lastCueAt,
  members,
  type Member,
} from "./schedule";
import { Stage, type CameraLayers, type StageState } from "./Stage";
import { resolveTheme, useThemeFonts } from "./themes";
import { Transport } from "./Transport";
// core first, then the themes, regardless of who else imports video.css
import "../../styles/video.css";
import "./themes.css";

function useViewport() {
  const [vp, setVp] = useState(() => ({
    W: window.innerWidth,
    H: window.innerHeight,
  }));
  useEffect(() => {
    const on = () => setVp({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function useReducedMotion() {
  const [r, setR] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
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
export function Video({
  tape,
  player,
  autoplay,
  onExit,
  onReplay,
}: {
  tape: Tape;
  player: Player;
  autoplay: boolean;
  onExit: () => void;
  /** replay this release's session in the studio */
  onReplay?: () => void;
}) {
  const theme = useMemo(() => resolveTheme(tape), [tape]);
  const video = useShareVideo(
    tape.id,
    `${tape.catalog ?? "sb"} ${tape.title}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );
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
    if (
      p.playing &&
      !player.playing &&
      player.time === 0 &&
      p.t > duration - 1.5
    )
      setEnded(true);
    prev.current = { t: player.time, playing: player.playing };
  }, [player.time, player.playing, duration]);

  // the recorder reads these: when playback started (wall clock, ms) and from where, and when it ended
  useEffect(() => {
    if (!RENDER) return;
    const w = window as unknown as { __sb?: Record<string, number> };
    w.__sb = w.__sb ?? {};
    if (player.playing && w.__sb.start == null)
      Object.assign(w.__sb, { start: Date.now(), from: player.time });
    if (ended && w.__sb.end == null) w.__sb.end = Date.now();
  }, [player.playing, player.time, ended]);

  // the cold open: a fresh or finished video waits a few bars before the first vocal, not at 0:00
  const armed = useRef(true);
  useEffect(() => {
    armed.current = true;
  }, [tape]);
  useEffect(() => {
    if (ended) armed.current = true;
  }, [ended]);

  const t = ended ? duration : player.time;
  const started = player.playing || player.time > 0 || ended;
  const bpm = tape.bpm > 30 ? tape.bpm : 100;
  const beats = (t * bpm) / 60;

  // what's on screen
  const { cues, titleEnd, creditsStart, openAt, rollFrom } = tl;
  useEffect(() => {
    // stays armed until the seek sticks: the player resets a fresh tape to 0:00 in its own effect, which runs
    // after this one (parent after child), and a one-shot seek here was lost to it outside dev's double effects
    if (player.playing || player.time > 0) armed.current = false;
    else if (armed.current && (openAt > 0 || RENDER_AT > 0)) player.seek(RENDER_AT > 0 ? RENDER_AT : openAt);
  }, [player, player.playing, player.time, openAt]);
  const cur = cueAt(cues, t);
  const last = lastCueAt(cues, t);
  const finished = cur >= 0 ? cur - 1 : last;
  const out =
    finished >= 0 &&
    t >= cues[finished].until &&
    t < cues[finished].until + 0.45
      ? finished
      : -1;
  // the opening: a short title card, then the roll call (a member onto the stage every two beats), then the first vocal
  const inTitle = t < rollFrom && !ended;
  const inRoll = !ended && t >= rollFrom && t < titleEnd;
  const rollStep = Math.max(
    0.16,
    Math.min(
      120 / bpm, // two beats each: long enough to read who they are
      (titleEnd - rollFrom) / Math.max(1, tape.photos.length + 0.5),
    ),
  );
  const held =
    cur >= 0
      ? cues[cur]
      : last >= 0 && t - cues[last].until < 2.5
        ? cues[last]
        : null;
  const credits = t >= creditsStart;
  const n = tape.photos.length;

  // the director's shot list, when the tape has one
  const takes = useMemo(() => plan(tape, tl, bpm), [tape, tl, bpm]);
  const take = takes ? takes[takeAt(takes, t)] : null;
  // each member is introduced on the first shot that singles them out
  const introOf = useMemo(() => {
    const m = new Map<number, number>();
    const seen = new Set<number>();
    takes?.forEach((k) => {
      if (k.cue < 0 || !SINGLE.includes(k.shot)) return;
      const s = k.subjects[0];
      if (!seen.has(s)) {
        seen.add(s);
        m.set(k.index, s);
      }
    });
    return m;
  }, [takes]);

  let mode: StageState["mode"];
  let side: 0 | 1;
  let solo: number | null = null;
  let flashShown = "";
  let frozen = false;
  let intro: Member | null = null;
  if (take) {
    const single = take.fx !== "split" && SINGLE.includes(take.shot);
    // under the credits roll the lyrics move to the left column, whatever the shot
    mode = inTitle ? "title" : credits ? "lineup" : single ? "verse" : "lineup";
    side = single ? take.side : 0;
    if (!inTitle && !(credits && take.fx === "split")) {
      const [a, b] = take.subjects;
      if (take.fx === "split")
        flashShown = b != null ? `${a}:left,${b}:right` : `${a}:left`;
      else if (take.shot === "photo") flashShown = `${a}:full`;
      else if (take.shot === "close-up" && held && held.photo === a)
        flashShown = `${a}:full`;
    }
    frozen =
      take.fx === "freeze" && t - take.from < freezeHold(bpm) && !inTitle;
    const who = introOf.get(take.index);
    if (
      who != null &&
      !inTitle &&
      !credits &&
      t < take.from + Math.max(4.2, Math.min(take.to - take.from, 6))
    )
      intro = band[who] ?? null;
  } else {
    const verse =
      !inTitle && !credits && held && held.photo != null && !held.chorus;
    mode = inTitle ? "title" : verse ? "verse" : "lineup";
    solo =
      !inTitle && !held && !credits && n > 1 ? Math.floor(beats / 8) % n : null;
    side = verse && held ? held.side : 0;
    flashShown =
      !inTitle && held && held.photo != null ? `${held.photo}:full` : "";
  }

  if (inRoll) {
    mode = "lineup";
    side = 0;
    solo = null;
    flashShown = "";
    frozen = false;
    const who = Math.min(n - 1, Math.floor((t - rollFrom) / rollStep));
    intro = who >= 0 ? (band[who] ?? null) : null;
  }

  if (!take && !inTitle && !inRoll && !credits) {
    for (let j = last; j >= 0 && cues[j].start > t - 5; j -= 1) {
      const c = cues[j];
      if (c.intro && c.photo != null) {
        // introduce them while they are the one fronting, for at least a few seconds
        if (
          held &&
          held.photo === c.photo &&
          t < Math.max(c.until, c.start + 4.2)
        )
          intro = band[c.photo] ?? null;
        break;
      }
    }
  }

  const live = useRef<StageState>({
    mode,
    front: null,
    side,
    solo,
    credits,
    t,
    bpm,
    take,
  });
  live.current = {
    mode,
    front: mode === "verse" && held ? held.photo : null,
    side,
    solo,
    credits,
    t,
    bpm,
    take: inRoll ? null : take,
    roll: inRoll ? { from: rollFrom, step: rollStep } : null,
  };
  const layers = useRef<CameraLayers>({ bd: null, vf: null });
  const setVf = useCallback((el: HTMLDivElement | null) => {
    layers.current.vf = el;
  }, []);
  const shotFx =
    take && !inTitle && !inRoll && !reduced && !(credits && take.fx === "split")
      ? take.fx
      : "none";

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
    const ua = (
      navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    ).userActivation;
    if (ua && !ua.hasBeenActive && !RENDER) return;
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
  const keys = useRef({
    toggle,
    seek,
    toggleFull,
    wake,
    t: player.time,
    duration,
  });
  keys.current = { toggle, seek, toggleFull, wake, t: player.time, duration };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
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

  const creditsProgress =
    (t - creditsStart) / Math.max(1, duration - creditsStart);
  const rootStyle = {
    "--beat": `${(60 / bpm).toFixed(4)}s`,
    "--bar": `${(240 / bpm).toFixed(4)}s`,
  } as CSSProperties;

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
      data-flash={flashShown ? 1 : 0}
      data-shot={take && !inTitle ? take.shot : undefined}
      data-move={take && !inTitle ? take.move : undefined}
      data-fx={shotFx}
      data-freeze={frozen ? 1 : 0}
      data-idle={show ? 0 : 1}
      data-reduced={reduced ? 1 : 0}
      data-render={RENDER ? 1 : undefined}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake();
        if (e.pointerType === "mouse" && started && e.button === 0) toggle();
      }}
    >
      <div className="video-world">
        <div className="vcam-bd" ref={(el) => (layers.current.bd = el)}>
          <Backdrop theme={theme} tape={tape} />
        </div>
        <Flash tape={tape} theme={theme} shown={flashShown} camRef={setVf} />
        <Stage
          tape={tape}
          theme={theme}
          live={live}
          layers={layers}
          W={W}
          H={H}
          reduced={reduced}
        />
        <div className="vsx" aria-hidden="true">
          <i className="vsx-strobe" />
          <i className="vsx-split" />
          <i className="vsx-freeze" />
          {take && !inTitle && take.fx === "flash" && !reduced && (
            <i key={`cut${take.index}`} className="vsx-cut" />
          )}
        </div>
        {(started || !inTitle) && (
          <Lyrics
            cues={cues}
            cur={cur}
            out={out}
            t={t}
            theme={theme}
            layout={`${mode}:${side}:${credits ? 1 : 0}:${W}x${H}`}
          />
        )}
        <LowerThird member={intro} side={side} theme={theme} />
        <Credits
          tape={tape}
          band={band}
          on={credits && !ended}
          progress={creditsProgress}
          theme={theme}
        />
        <TitleCard tape={tape} theme={theme} on={inTitle} />
        <Fx theme={theme} />
      </div>

      <div className="vwm" aria-hidden="true">
        <span className="wordmark">songbird</span>
        <i className="vwm-dot" />
        <span className="num">{tape.catalog}</span>
      </div>

      {!started && !RENDER && (
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
          {RENDER && (
            <div className="vend-made">your day, on record · songbird</div>
          )}
          {!RENDER && (
            <div className="vend-actions">
              <button
                className="vend-btn is-primary"
                onClick={() => void video.ask()}
                data-busy={video.busy ? 1 : 0}
              >
                <span className="label">{video.label}</span>
              </button>
              <button className="vend-btn" onClick={toggle}>
                <span className="label">Play again</span>
              </button>
              <button className="vend-btn" onClick={() => void share()}>
                <span className="label">
                  {copied ? "Link copied" : "Copy link"}
                </span>
              </button>
              {onReplay && (
                <button className="vend-btn" onClick={onReplay}>
                  <span className="label">Watch it get made</span>
                </button>
              )}
              <button className="vend-btn" onClick={onExit}>
                <span className="label">Back to the studio</span>
              </button>
            </div>
          )}
        </div>
      )}

      {!RENDER && (
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
            video={{
              label: video.label,
              busy: video.busy,
              ask: () => void video.ask(),
            }}
            onExit={onExit}
            onReplay={onReplay}
          />
        </div>
      )}
    </main>
  );
}
