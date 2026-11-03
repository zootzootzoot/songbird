import { memo, type CSSProperties } from "react";
import { media } from "../../lib/env";
import { IN_KEY, NOTES, TAKE_COUNT, scaleOf, usePeaks, type TakeView } from "./model";

export type LaneView = TakeView & {
  /** the tape is rolling on this lane: elapsed since it armed */
  recClock: string | null;
  /** the A&R verdict has been read out on this lane (verdicts arrive together; the room reads them in order) */
  readOut: boolean;
  /** show the KEPT stamp */
  stamped: boolean;
};

type Props = { lanes: LaneView[] };

export function Takes({ lanes }: Props) {
  const cut = lanes.filter((l) => l.arrived && l.cut).length;
  return (
    <section className="rm-panel rm-takes" aria-label="takes">
      <header className="rm-head">
        <span className="label">Takes</span>
        <span className="rm-head__sub label">ACE-Step 1.5 XL / Demucs / Spark 1.2</span>
        <span className="rm-head__read num">
          CUT &lt; {Math.round(IN_KEY * 100)}% <span className="rm-dimnum">· {cut}/{TAKE_COUNT}</span>
        </span>
      </header>
      <ol className="rm-takes__list">
        {lanes.map((l) => (
          <Lane key={l.index} l={l} />
        ))}
      </ol>
    </section>
  );
}

const STATUS: Record<LaneView["status"], string> = {
  armed: "ARMED",
  rec: "REC",
  tuned: "TUNED",
  cut: "CUT",
  listening: "A&R",
  heard: "HEARD",
  kept: "KEPT",
};

const Lane = memo(function Lane({ l }: { l: LaneView }) {
  const status = l.status === "kept" && !l.stamped ? "heard" : l.status;
  const showVerdict = l.verdict !== undefined && (l.cut || l.readOut);
  const score = l.scored && l.readOut ? l.score : undefined;
  return (
    <li className="rm-take" data-status={status} data-cut={(l.arrived && l.cut) || undefined}>
      <div className="rm-take__head">
        <span className="rm-take__no num">T{l.index + 1}</span>
        <span className="rm-chip" data-status={status}>
          <i />
          {STATUS[status]}
          {status === "rec" && l.recClock && <span className="num"> {l.recClock}</span>}
        </span>
        <span className="rm-take__file num">{l.arrived ? `take-${l.index}.mp3` : ""}</span>
        <span className="rm-take__score num" data-on={score !== undefined || undefined}>
          {score !== undefined ? score.toFixed(2) : "-.--"}
        </span>
      </div>

      <div className="rm-take__wave">
        {l.arrived ? <Wave src={media(l.audio ?? null)} /> : <Reel rolling={l.status === "rec"} />}
        {l.stamped && (
          <div className="rm-kept" aria-label="kept">
            KEPT
          </div>
        )}
      </div>

      <Tuner l={l} />

      <div className="rm-take__verdict">
        {showVerdict ? (
          l.cut ? (
            <p className="rm-verdict rm-verdict--cut">{l.verdict}</p>
          ) : (
            <p className="rm-verdict">
              <span className="rm-verdict__who label">Spark 1.2</span>
              <q>{l.verdict}</q>
            </p>
          )
        ) : l.status === "listening" ? (
          <p className="rm-verdict rm-verdict--wait label">Muse Spark 1.2 is listening to the whole take</p>
        ) : null}
        {l.scored && l.readOut && (
          <div className="rm-scores num">
            <span>VOICE {fmt(l.voice)}</span>
            <span>WORDS {fmt(l.words)}</span>
            <span>GENRE {fmt(l.genre)}</span>
            {typeof l.sung === "number" && <span>SUNG {Math.round(l.sung * 100)}%</span>}
          </div>
        )}
      </div>

    </li>
  );
});

const fmt = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(1));

function Reel({ rolling }: { rolling: boolean }) {
  return <div className="rm-reel" data-rolling={rolling || undefined} />;
}

const BINS = 96;

const Wave = memo(function Wave({ src }: { src: string | null }) {
  const { peaks, failed } = usePeaks(src, BINS);
  if (!peaks) return <div className="rm-wave rm-wave--flat" data-failed={failed || undefined} />;
  const bars: string[] = [];
  const w = 100 / BINS;
  for (let i = 0; i < BINS; i += 1) {
    const h = Math.max(0.03, Math.pow(peaks[i], 1.8)) * 48; // RMS, expanded so the sections read
    bars.push(`M${(i * w + w * 0.18).toFixed(2)} ${(50 - h).toFixed(2)}h${(w * 0.64).toFixed(2)}v${(h * 2).toFixed(2)}h${(-w * 0.64).toFixed(2)}z`);
  }
  return (
    <svg className="rm-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path d={bars.join("")} />
    </svg>
  );
});

/**
 * The Demucs reading. Demucs splits the take into the singer and the band; the
 * tuner names the band's key and the key the singer actually sang in, then
 * measures how much of the sung time sat on the band's scale. Both scales are
 * drawn on one chromatic ruler; the two lanes pull apart by how far off the
 * singer was.
 */
function Tuner({ l }: { l: LaneView }) {
  const band = scaleOf(l.bandKey);
  const vox = scaleOf(l.vocalKey);
  const reading = l.arrived && typeof l.inKey === "number";
  const pct = reading ? Math.round((l.inKey as number) * 100) : null;
  const off = reading ? 1 - (l.inKey as number) : 0;
  return (
    <div className="rm-tuner" data-on={l.arrived || undefined} style={{ ["--split" as string]: off.toFixed(3) } as CSSProperties}>
      <div className="rm-tuner__lanes">
        <Row tag="BAND" keyName={l.arrived ? l.bandKey ?? "?" : ""} scale={band} ref_={null} />
        <Row tag="VOX" keyName={l.arrived ? l.vocalKey ?? "no singing found" : ""} scale={vox} ref_={band} vox />
      </div>
      <div className="rm-inkey">
        <div className="rm-inkey__bar">
          <span
            className="rm-inkey__fill"
            data-pass={pct !== null && pct >= IN_KEY * 100 ? "1" : pct !== null ? "0" : undefined}
            style={{ width: `${pct ?? 0}%` }}
          />
          <span className="rm-inkey__line" style={{ left: `${IN_KEY * 100}%` }} />
        </div>
        <span className="rm-inkey__read num" data-pass={pct !== null ? (pct >= IN_KEY * 100 ? "1" : "0") : undefined}>
          {pct !== null ? `${pct}%` : "--%"}
        </span>
        <span className="rm-inkey__tag label">in key</span>
      </div>
    </div>
  );
}

function Row({
  tag,
  keyName,
  scale,
  ref_,
  vox = false,
}: {
  tag: string;
  keyName: string;
  scale: Set<number> | null;
  ref_: Set<number> | null;
  vox?: boolean;
}) {
  return (
    <div className="rm-krow" data-vox={vox || undefined}>
      <span className="rm-krow__tag label">{tag}</span>
      <span className="rm-krow__key num">{keyName}</span>
      <span className="rm-krow__cells">
        {NOTES.map((n, pc) => {
          const on = scale?.has(pc) ?? false;
          const clash = vox && on && ref_ !== null && !ref_.has(pc);
          return <i key={n} data-on={on || undefined} data-clash={clash || undefined} title={n} />;
        })}
      </span>
    </div>
  );
}
