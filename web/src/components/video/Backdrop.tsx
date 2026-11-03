import { memo, type CSSProperties } from "react";
import type { Tape } from "../../lib/types";
import type { Theme } from "./themes";
import { hash } from "./schedule";

const v = (o: Record<string, string | number>) => o as CSSProperties;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** 8-point atomic starburst */
function Burst({ x, y, s, d, c }: { x: number; y: number; s: number; d: number; c: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? (i % 4 === 0 ? 1 : 0.55) : 0.12;
    pts.push(`${(Math.cos(a) * r * 50).toFixed(1)},${(Math.sin(a) * r * 50).toFixed(1)}`);
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${s / 100})`}>
      <polygon className="at-burst" points={pts.join(" ")} fill={c} style={v({ "--d": `${d}s` })} />
    </g>
  );
}

/** The world behind the band, one per family. Animated with CSS on the beat clock (--beat). */
export const Backdrop = memo(function Backdrop({ theme, tape }: { theme: Theme; tape: Tape }) {
  switch (theme.family) {
    case "neon":
      return (
        <div className="bd bd-neon" aria-hidden="true">
          <div className="nn-sky" />
          <div className="nn-stars" />
          <div className="nn-sun">
            <div className="nn-sun-core" />
          </div>
          <svg className="nn-mtn" viewBox="0 0 1600 200" preserveAspectRatio="none">
            <polygon points="0,200 0,150 120,80 230,140 360,40 470,130 560,95 700,150 1600,150 1600,200" />
            <polygon points="900,150 1010,70 1120,120 1240,30 1360,110 1450,75 1600,135 1600,200 900,200" />
            <polyline points="0,150 120,80 230,140 360,40 470,130 560,95 700,150" />
            <polyline points="900,150 1010,70 1120,120 1240,30 1360,110 1450,75 1600,135" />
          </svg>
          <div className="nn-floor">
            <div className="nn-grid" />
          </div>
          <div className="nn-horizon" />
          {theme.variant === "italo" && (
            <div className="nn-lasers">
              {range(7).map((i) => (
                <i key={i} style={v({ "--i": i })} />
              ))}
            </div>
          )}
        </div>
      );
    case "strut":
      return (
        <div className="bd bd-strut" aria-hidden="true">
          <div className="st-rays" />
          <svg className="st-swoosh" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
            {["#f3dcae", "#f2b230", "#e8762a", "#c9441f", "#7a2a12"].map((c, i) => (
              <path
                key={c}
                d={`M -500 ${980 - i * 70} L -200 ${980 - i * 70} C 300 ${980 - i * 70}, 600 ${380 - i * 70}, 1000 ${360 - i * 70} S 1500 ${120 - i * 70}, 1900 ${80 - i * 70} L 2300 ${40 - i * 70}`}
                stroke={c}
                strokeWidth="62"
                fill="none"
              />
            ))}
          </svg>
          <div className="st-riser">
            {range(3).map((r) => (
              <div key={r} className="st-tier" style={v({ "--r": r })}>
                <div className="st-bulbs" />
              </div>
            ))}
          </div>
        </div>
      );
    case "deco":
      return (
        <div className="bd bd-deco" aria-hidden="true">
          <div className="dc-rays" />
          <svg className="dc-arch" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
            {range(7).map((i) => (
              <path key={i} d={`M ${200 + i * 60} 900 L ${200 + i * 60} ${520 - i * 10} A ${600 - i * 60} ${560 - i * 50} 0 0 1 ${1400 - i * 60} ${520 - i * 10} L ${1400 - i * 60} 900`} />
            ))}
            <path className="dc-step" d="M 0 120 L 120 120 L 120 60 L 240 60 L 240 0 M 1600 120 L 1480 120 L 1480 60 L 1360 60 L 1360 0" />
            <path className="dc-step" d="M 0 140 L 140 140 L 140 80 L 260 80 L 260 20 M 1600 140 L 1460 140 L 1460 80 L 1340 80 L 1340 20" />
          </svg>
          <div className="dc-spot l" />
          <div className="dc-spot r" />
          <div className="dc-floor" />
        </div>
      );
    case "twotone":
      return (
        <div className="bd bd-two" aria-hidden="true">
          <div className="tt-wall" />
          <div className="tt-slab" />
          <div className="tt-ring" />
          <div className="tt-strip top">
            <i />
          </div>
          <div className="tt-floor">
            <div className="tt-checks" />
          </div>
        </div>
      );
    case "arena":
      return (
        <div className="bd bd-arena" aria-hidden="true">
          <div className="ar-wash" />
          <div className="ar-beams">
            {range(theme.variant === "ballad" ? 5 : 8).map((i, _, a) => (
              <i key={i} style={v({ "--i": i, "--n": a.length, "--x": `${((i + 0.5) / a.length) * 100}%` })} />
            ))}
          </div>
          <svg className="ar-truss" viewBox="0 0 1600 60" preserveAspectRatio="none">
            <rect x="0" y="8" width="1600" height="4" />
            <rect x="0" y="40" width="1600" height="4" />
            {range(40).map((i) => (
              <path key={i} d={`M ${i * 40} 12 L ${i * 40 + 20} 40 L ${i * 40 + 40} 12`} />
            ))}
          </svg>
          <div className="ar-lamps">
            {range(theme.variant === "ballad" ? 5 : 8).map((i, _, a) => (
              <i key={i} style={v({ "--x": `${((i + 0.5) / a.length) * 100}%` })} />
            ))}
          </div>
          <div className="ar-smoke">
            <i />
            <i />
            <i />
          </div>
          <div className="ar-flare">
            <i className="streak" />
            <i className="ghost a" />
            <i className="ghost b" />
            <i className="ghost c" />
          </div>
        </div>
      );
    case "zine":
      return (
        <div className="bd bd-zine" aria-hidden="true">
          <div className="zn-paper" />
          <div className="zn-type">{(tape.artist || tape.title).toUpperCase()}</div>
          <div className="zn-scraps">
            {tape.photos.slice(0, 6).map((p, i) => (
              <div
                key={i}
                className="zn-scrap"
                style={v({
                  "--x": `${[3, 74, 6, 78, 40, 58][i]}%`,
                  "--y": `${[6, 4, 58, 56, 2, 66][i]}%`,
                  "--r": `${((hash(`s${i}`) - 0.5) * 16).toFixed(1)}deg`,
                })}
              >
                <img src={p.src} alt="" decoding="async" />
                <i className="zn-tape" />
              </div>
            ))}
          </div>
          <div className="zn-hl a" />
          <div className="zn-hl b" />
          <div className="zn-band" />
        </div>
      );
    case "atomic":
      return (
        <div className="bd bd-atomic" aria-hidden="true">
          <div className="at-wall" />
          {theme.variant === "surf" ? (
            <>
              <div className="at-sun" />
              <svg className="at-waves" viewBox="0 0 1600 400" preserveAspectRatio="none">
                {range(3).map((i) => (
                  <g key={i} className={`at-wave w${i}`}>
                    <path
                      d={(() => {
                        let d = `M -1600 ${140 + i * 80}`;
                        for (let x = -1600; x < 3200; x += 200) d += ` q 50 -${50 - i * 8} 100 0 t 100 0`;
                        return `${d} L 3200 400 L -1600 400 Z`;
                      })()}
                    />
                  </g>
                ))}
              </svg>
            </>
          ) : (
            <>
              <div className="at-boomer a" />
              <div className="at-boomer b" />
              <div className="at-boomer c" />
              <div className="at-orbit">
                <i />
                <i />
                <i />
              </div>
            </>
          )}
          <svg className="at-stars" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
            <Burst x={170} y={150} s={150} d={9} c="var(--a2)" />
            <Burst x={1440} y={190} s={190} d={12} c="var(--a1)" />
            <Burst x={1300} y={520} s={70} d={7} c="var(--a2)" />
            <Burst x={360} y={430} s={80} d={8} c="var(--a1)" />
            <Burst x={820} y={90} s={60} d={6} c="var(--ink)" />
            <Burst x={90} y={640} s={110} d={10} c="var(--a1)" />
            <Burst x={1540} y={760} s={90} d={9} c="var(--ink)" />
          </svg>
        </div>
      );
    case "bluenote":
      return (
        <div className="bd bd-blue" aria-hidden="true">
          <div className="bn-field" />
          <div className="bn-bar a" />
          <div className="bn-bar b" />
          <div className="bn-bar c" />
          <div className="bn-cat num">{tape.catalog ?? ""}</div>
        </div>
      );
    case "milonga":
      return theme.variant === "salsa" ? (
        <div className="bd bd-salsa" aria-hidden="true">
          <div className="sa-blocks">
            {range(6).map((i) => (
              <i key={i} style={v({ "--i": i })} />
            ))}
          </div>
          <div className="sa-sun" />
          <div className="sa-stripes" />
        </div>
      ) : (
        <div className="bd bd-tango" aria-hidden="true">
          <div className="tg-curtain" />
          <div className="tg-cone" />
          <div className="tg-pool" />
          <svg className="tg-lines" viewBox="0 0 1600 900" preserveAspectRatio="none">
            <line x1="0" y1="900" x2="1600" y2="40" />
            <line x1="0" y1="860" x2="1600" y2="0" />
          </svg>
        </div>
      );
    case "bit":
      return (
        <div className="bd bd-bit" aria-hidden="true">
          <div className="bt-sky" />
          <div className="bt-stars" />
          <div className="bt-moon" />
          <div className="bt-hills">
            <i />
          </div>
          <div className="bt-ground">
            <i />
          </div>
        </div>
      );
  }
});

/** The layer over everything: scanlines, grain, CRT, haze. */
export const Fx = memo(function Fx({ theme }: { theme: Theme }) {
  return (
    <div className={`fx fx-${theme.family}`} aria-hidden="true">
      <i className="fx-a" />
      <i className="fx-b" />
      {theme.family === "arena" && (
        <>
          {theme.variant === "ballad" && (
            <div className="fx-lighters">
              {range(26).map((i) => (
                <i
                  key={i}
                  style={v({
                    "--x": `${(hash(`l${i}`) * 96 + 2).toFixed(1)}%`,
                    "--y": `${(hash(`m${i}`) * 30 + 30).toFixed(1)}%`,
                    "--d": `${(2.6 + hash(`d${i}`) * 2).toFixed(2)}s`,
                  })}
                />
              ))}
            </div>
          )}
          <svg className="fx-crowd" viewBox="0 0 1600 160" preserveAspectRatio="none">
            <path d={CROWD} />
          </svg>
        </>
      )}
    </div>
  );
});

/** heads and a few raised fists, front of house */
const CROWD = (() => {
  let d = "M 0 160 L 0 110";
  for (let x = 0; x <= 1600; x += 40) {
    const h = 70 + hash(`c${x}`) * 40;
    const arm = hash(`a${x}`) > 0.62;
    d += ` Q ${x + 10} ${160 - h - 26} ${x + 20} ${160 - h}`;
    if (arm) d += ` L ${x + 21} ${160 - h - 40} L ${x + 19} ${160 - h - 50} L ${x + 27} ${160 - h - 54} L ${x + 30} ${160 - h - 42} L ${x + 28} ${160 - h}`;
    d += ` Q ${x + 30} ${160 - h + 8} ${x + 40} ${160 - h + 10}`;
  }
  return `${d} L 1600 160 Z`;
})();
