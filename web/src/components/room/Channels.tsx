import { memo, useState } from "react";
import { media } from "../../lib/env";
import type { Box } from "../../lib/types";
import { coverPlate, pad2 } from "./model";

export type ChannelView = {
  k: number;
  src: string | null;
  video: boolean;
  hero: string | null;
  seen: string | null;
  cut: { cutout: string | null; box: Box | null; motion?: string | null; motionBox?: Box | null } | null;
  role: string | null;
  lines: number;
  /** 0..1: how hard the producer is addressing this channel right now */
  level: number;
  /** the producer's attention: its lyric line is typing, or it is being auditioned */
  focus: boolean;
};

type Props = {
  channels: ChannelView[];
  looking: boolean;
  cutN: number;
  seenN: number;
};

export function Channels({ channels, looking, cutN, seenN }: Props) {
  return (
    <section className="rm-panel rm-chan" aria-label="channels">
      <header className="rm-head">
        <span className="label">Channels</span>
        <span className="rm-head__sub label">Spark 1.3 / SAM 3.1</span>
        <span className="rm-head__read num">
          {pad2(cutN)}/{pad2(seenN || channels.length)} CUT
        </span>
      </header>
      <ol className="rm-chan__list" style={{ gridTemplateRows: `repeat(${Math.max(1, channels.length)}, minmax(0, 1fr))` }}>
        {channels.map((c) => (
          <Strip key={c.k} c={c} looking={looking} />
        ))}
      </ol>
    </section>
  );
}

const SEGMENTS = 10;

const Strip = memo(function Strip({ c, looking }: { c: ChannelView; looking: boolean }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const moving = Boolean(c.cut?.motion);
  const sticker = media(c.cut?.motion ?? c.cut?.cutout ?? null);
  const box = (moving ? c.cut?.motionBox : null) ?? c.cut?.box ?? null;
  const lit = Math.round(c.level * SEGMENTS);
  // SAM's cutout lifts off the photo and comes forward to the middle of the frame
  let lift: Record<string, string> = {};
  if (box) {
    const r = nat && nat.w && nat.h ? nat.w / nat.h : 1;
    const rw = Math.max(1, r);
    const rh = Math.max(1, 1 / r);
    const bw = Math.max(0.02, box[2] - box[0]);
    const bh = Math.max(0.02, box[3] - box[1]);
    const s = Math.max(1.1, Math.min(0.76 / (bw * rw), 0.76 / (bh * rh), 3.2));
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    lift = {
      "--tx": (((0.5 - cx) / bw) * 100).toFixed(1),
      "--ty": (((0.5 - cy) / bh) * 100 + 4).toFixed(1),
      "--s": s.toFixed(3),
    };
  }
  const state = !c.hero ? (looking ? "looking" : "idle") : c.cut ? (sticker ? "cast" : "nocut") : "seen";

  return (
    <li className="rm-strip" data-state={state} data-focus={c.focus || undefined}>
      <span className="rm-strip__no num">{pad2(c.k + 1)}</span>

      <div className="rm-photo">
        <div className="rm-plate" style={coverPlate(nat)}>
          {c.src &&
            (c.video ? (
              <video
                className="rm-plate__img"
                src={c.src}
                muted
                loop
                autoPlay
                playsInline
                onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              />
            ) : (
              <img
                className="rm-plate__img"
                src={c.src}
                alt=""
                onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            ))}
          {box && sticker && (
            <>
              <span
                className="rm-box"
                style={{
                  left: `${box[0] * 100}%`,
                  top: `${box[1] * 100}%`,
                  width: `${(box[2] - box[0]) * 100}%`,
                  height: `${(box[3] - box[1]) * 100}%`,
                }}
              />
              <img
                className="rm-cutout"
                src={sticker}
                alt=""
                style={{
                  left: `${box[0] * 100}%`,
                  top: `${box[1] * 100}%`,
                  width: `${(box[2] - box[0]) * 100}%`,
                  height: `${(box[3] - box[1]) * 100}%`,
                  ...lift,
                }}
              />
            </>
          )}
        </div>
        {looking && !c.hero && <span className="rm-scan" />}
      </div>

      <div className="rm-strip__body">
        <div className="rm-strip__name">{c.hero ?? (looking ? "looking" : "input")}</div>
        {c.seen && <p className="rm-strip__seen">{c.seen}</p>}
        <div className="rm-strip__role">{c.role ? <span key={c.role}>{c.role}</span> : null}</div>
        <div className="rm-strip__tech num">
          {c.cut ? (
            sticker ? (
              <>
                <span className="rm-tag" data-tone="vu">{moving ? "SAM TRACK" : "SAM CUT"}</span>
                {box && (
                  <span>
                    {box.map((v) => v.toFixed(2).replace(/^0/, "")).join(" ")}
                  </span>
                )}
              </>
            ) : (
              <span className="rm-tag">NO CUT</span>
            )
          ) : c.hero ? (
            <span className="rm-tag" data-tone="dim">CUTTING</span>
          ) : null}
          {c.lines > 0 && <span className="rm-strip__ln">LN {pad2(c.lines)}</span>}
        </div>
      </div>

      <div className="rm-meter" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const seg = SEGMENTS - i; // top first
          return <i key={i} data-on={seg <= lit || undefined} data-hot={seg > SEGMENTS - 2 || undefined} style={{ ["--d" as string]: i }} />;
        })}
      </div>
    </li>
  );
});
