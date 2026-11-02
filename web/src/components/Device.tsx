import { useState } from "react";
import { STAGES, type Stage } from "../lib/types";
import { useFit } from "../lib/useFit";
import { Cassette } from "./Cassette";
import { Producer, type ProducerMood } from "./Producer";

/**
 * The helpers inside the machine, one module per stage. They light up in turn,
 * so it is legible which Meta model (or which of our own parts) is working.
 */
export const CHAIN: Record<Stage, { short: string; model: string; verb: string; act: string }> = {
  looking: { short: "spark", model: "muse spark 1.3", verb: "is looking", act: "act i · looking" },
  cutting: { short: "sam 3.1", model: "sam 3.1", verb: "is casting", act: "act ii · casting" },
  producing: { short: "wonder", model: "muse wonder 1.0", verb: "is producing", act: "act iii · the producer" },
  recording: { short: "ace-step", model: "ace-step 1.5", verb: "is recording", act: "act v · recording" },
  listening: { short: "a&r", model: "muse spark 1.2", verb: "is listening", act: "act vi · listening back" },
  pressing: { short: "image", model: "muse image 1.0", verb: "is pressing", act: "act vii · pressing" },
};

const DESIGN_W = 860; // includes the lever, which stands proud of the body

function Meter({ level, live, side }: { level: number; live: boolean; side: string }) {
  const ticks = [-48, -36, -24, -12, 0, 12, 24, 36, 48];
  return (
    <div className="vu" data-live={live}>
      <svg viewBox="0 0 120 92" aria-hidden="true">
        <rect x="1" y="1" width="118" height="90" rx="9" className="vu__face" />
        <path d="M18 70 A50 50 0 0 1 102 70" className="vu__arc" />
        <path d="M80 30 A50 50 0 0 1 102 70" className="vu__red" />
        {ticks.map((d) => (
          <line key={d} x1="60" y1="24" x2="60" y2={d % 24 === 0 ? 16 : 19} transform={`rotate(${d} 60 76)`} className="vu__tick" />
        ))}
        <text x="13" y="52" className="vu__num">-20</text>
        <text x="54" y="13" className="vu__num">0</text>
        <text x="100" y="40" className="vu__num vu__num--red">+3</text>
        <text x="60" y="62" className="vu__label">vu</text>
        <text x="12" y="84" className="vu__side">{side}</text>
        <g className="vu__needle-wrap" style={{ transform: `rotate(${-48 + level * 92}deg)` }}>
          <line x1="60" y1="76" x2="60" y2="20" className="vu__needle" />
        </g>
        <circle cx="60" cy="76" r="5" className="vu__pin" />
        <rect x="1" y="1" width="118" height="90" rx="9" className="vu__glass" />
      </svg>
    </div>
  );
}

/** the songbird mark: a stout wooden-toy bird in two inks */
export function Bird({ className = "" }: { className?: string }) {
  return (
    <g className={`bird ${className}`} transform="translate(-14 -12) scale(0.22)">
      <path d="M8 74 L44 58 L38 98 Z" fill="var(--ocean)" />
      <path d="M30 100 C18 80 24 50 46 38 C66 28 88 36 94 58 C100 82 86 104 62 108 C48 110 38 108 30 100 Z" fill="var(--sun)" />
      <circle cx="46" cy="82" r="24" fill="var(--vermilion)" opacity="0.92" />
      <circle cx="82" cy="44" r="21" fill="var(--sun)" />
      <circle cx="88" cy="40" r="3.6" fill="var(--ink)" />
      <path d="M101 42 L120 48 L101 54 Z" fill="var(--vermilion)" />
    </g>
  );
}

export function Device(props: {
  phase: string;
  stage: Stage | null;
  stageLive: boolean;
  doneStages: boolean;
  display: { top: string; right: string; bottom: string };
  name: string;
  setName: (v: string) => void;
  nameEditable: boolean;
  title: string | null;
  spinning: boolean;
  fast: boolean;
  wound: number;
  generation: number;
  level: number;
  recording: boolean;
  take: number;
  mood: ProducerMood;
  beat: number;
  leverReady: boolean;
  leverDown: boolean;
  onPull: () => void;
  canPlay: boolean;
  playing: boolean;
  canStop: boolean;
  canEject: boolean;
  onPlay: () => void;
  onStop: () => void;
  onEject: () => void;
}) {
  const { ref, scale } = useFit<HTMLDivElement>(DESIGN_W, 1.15);
  const [pressed, setPressed] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const stageIdx = props.stage ? STAGES.indexOf(props.stage) : props.doneStages ? STAGES.length : -1;

  return (
    <div className="device-fit" ref={ref} style={{ height: 560 * scale }}>
      <section
        className="device"
        aria-label="songbird sb-6, a family music box"
        data-phase={props.phase}
        data-jolt={props.leverDown}
        style={{ transform: `scale(${scale})` }}
      >
        <div className="device__shadow" aria-hidden="true" />
        <svg className="device__handle" viewBox="0 0 760 90" aria-hidden="true">
          <defs>
            <linearGradient id="handle-tube" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6c65a" />
              <stop offset="0.45" stopColor="#efb02f" />
              <stop offset="1" stopColor="#b97f14" />
            </linearGradient>
          </defs>
          <path d="M196 86 C196 30 230 18 290 18 L470 18 C530 18 564 30 564 86" fill="none" stroke="#7a520c" strokeWidth="24" strokeLinecap="round" opacity="0.35" transform="translate(0 4)" />
          <path d="M196 86 C196 30 230 18 290 18 L470 18 C530 18 564 30 564 86" fill="none" stroke="url(#handle-tube)" strokeWidth="20" strokeLinecap="round" />
          <path d="M206 70 C210 36 236 27 290 27 L470 27" fill="none" stroke="rgba(255,250,230,.55)" strokeWidth="3" strokeLinecap="round" />
          <rect x="178" y="70" width="36" height="22" rx="6" fill="#123247" />
          <rect x="546" y="70" width="36" height="22" rx="6" fill="#123247" />
        </svg>

        <div className="device__perch">
          <Producer mood={props.mood} beat={props.beat} />
        </div>

        <div className="device__body">
          <span className="device__sheen" aria-hidden="true" />
          <span className="device__grain" aria-hidden="true" />

          <div className="device__bay">
            <Cassette
              name={props.name}
              setName={props.setName}
              editable={props.nameEditable}
              title={props.title}
              spinning={props.spinning}
              fast={props.fast}
              wound={props.wound}
              generation={props.generation}
              ejecting={ejecting}
            />
            <span className="device__bay-glass" aria-hidden="true" />
          </div>

          <div className="meters">
            <Meter level={props.recording ? 0.6 : props.level} live={props.recording} side="l" />
            <Meter level={props.recording ? 0.55 : props.level * 0.92} live={props.recording} side="r" />
          </div>

          <div className="tally" data-on={props.recording}>
            <span className="tally__lamp" />
            <span className="tally__word">rec</span>
            <span className="tally__take">take {String(Math.max(1, props.take)).padStart(2, "0")}</span>
          </div>

          <div className="lcd" aria-live="polite">
            <div className="lcd__row">
              <span>{props.display.top}</span>
              <span>{props.display.right}</span>
            </div>
            <div className="lcd__line">{props.display.bottom}</div>
          </div>

          <ol className="chain" aria-label="the helpers inside">
            {STAGES.map((s, i) => (
              <li
                key={s}
                data-state={i < stageIdx ? "done" : i === stageIdx ? (props.stageLive ? "live" : "done") : "idle"}
                title={CHAIN[s].model}
              >
                <span className="chain__led" />
                <span className="chain__name">{CHAIN[s].short}</span>
              </li>
            ))}
          </ol>

          <div className="keys" role="group" aria-label="transport">
            <button
              type="button"
              className="key key--play"
              onClick={props.onPlay}
              disabled={!props.canPlay}
              data-down={props.playing}
              aria-pressed={props.playing}
              aria-label="play"
            >
              <span className="key__cap">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6 3.5 L16.5 10 L6 16.5 Z" />
                </svg>
              </span>
              <span className="key__word">play</span>
            </button>
            <button type="button" className="key" onClick={props.onStop} disabled={!props.canStop} aria-label="stop">
              <span className="key__cap">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="5" y="5" width="10" height="10" rx="1.5" />
                </svg>
              </span>
              <span className="key__word">stop</span>
            </button>
            <button
              type="button"
              className="key"
              onClick={() => {
                setEjecting(true);
                window.setTimeout(() => setEjecting(false), 520);
                props.onEject();
              }}
              disabled={!props.canEject}
              aria-label="eject"
            >
              <span className="key__cap">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4 L16 11 L4 11 Z" />
                  <rect x="4" y="13.5" width="12" height="2.6" rx="1" />
                </svg>
              </span>
              <span className="key__word">eject</span>
            </button>
          </div>

          <div className="device__print" aria-hidden="true">
            <span className="device__logo">
              <svg viewBox="-16 -14 32 28">
                <Bird />
              </svg>
              songbird
            </span>
            <span>sb-6 · a record label for small days</span>
          </div>
        </div>

        <div className="lever" data-ready={props.leverReady && !props.leverDown} data-down={props.leverDown || pressed}>
          <span className="lever__slot" aria-hidden="true" />
          <button
            type="button"
            className="lever__arm"
            disabled={!props.leverReady}
            aria-label={props.leverReady ? "pull the lever to make the song" : "the lever (clip in three pictures first)"}
            onPointerDown={() => props.leverReady && setPressed(true)}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            onClick={() => {
              setPressed(false);
              props.onPull();
            }}
          >
            <span className="lever__stem" />
            <span className="lever__ball" />
          </button>
          <span className="lever__word" aria-hidden="true">
            pull
          </span>
        </div>

        <span className="device__foot device__foot--l" aria-hidden="true" />
        <span className="device__foot device__foot--r" aria-hidden="true" />
      </section>
    </div>
  );
}
