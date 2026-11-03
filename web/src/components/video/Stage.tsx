import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Photo, Tape } from "../../lib/types";
import { pose } from "./motion";
import { Pixel } from "./Pixel";
import type { Theme } from "./themes";

export type StageMode = "title" | "verse" | "lineup";

export type StageState = {
  mode: StageMode;
  front: number | null;
  side: 0 | 1;
  /** during instrumental stretches one member takes a solo */
  solo: number | null;
  credits: boolean;
  t: number;
  bpm: number;
};

type Slot = { cx: number; base: number; boxW: number; boxH: number; o: number; z: number; role: "front" | "solo" | "back" | "line" };

function guessAspect(p: Photo) {
  const b = p.motion && p.motionBox ? p.motionBox : p.box;
  if (!b) return 1;
  const w = Math.max(0.05, b[2] - b[0]);
  const h = Math.max(0.05, b[3] - b[1]);
  return Math.max(0.35, Math.min(2.6, w / h));
}

function layout(st: StageState, n: number, W: number, H: number, portrait: boolean): Slot[] {
  const slots: Slot[] = [];
  const front = st.mode === "verse" ? st.front : null;
  if (front != null) {
    const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== front);
    const m = Math.max(1, others.length);
    for (let i = 0; i < n; i += 1) {
      if (i === front) {
        slots[i] = portrait
          ? { cx: W * 0.5, base: H * 0.43, boxW: W * 0.86, boxH: H * 0.33, o: 1, z: 5, role: "front" }
          : {
              cx: W * (st.side === 0 ? 0.27 : 0.73),
              base: H * 0.035,
              boxW: W * 0.44,
              boxH: H * 0.7,
              o: 1,
              z: 5,
              role: "front",
            };
      } else {
        const j = others.indexOf(i);
        const span = portrait ? W * 0.94 : W * 0.9;
        const left = (W - span) / 2;
        const cx = left + ((j + 0.5) * span) / m;
        slots[i] = portrait
          ? { cx, base: H * 0.43, boxW: (span / m) * 0.86, boxH: H * 0.1, o: 0.9, z: 2, role: "back" }
          : { cx, base: H * 0.02, boxW: Math.min(W * 0.15, (span / m) * 0.86), boxH: H * 0.21, o: 0.92, z: 2, role: "back" };
      }
    }
    return slots;
  }
  if (portrait && n > 3) {
    // phones: two rows, the back row raised and smaller
    const back = Math.ceil(n / 2);
    for (let i = 0; i < n; i += 1) {
      const row = i < back ? 0 : 1;
      const count = row === 0 ? back : n - back;
      const j = row === 0 ? i : i - back;
      const span = W * (row === 0 ? 0.86 : 0.94);
      const solo = st.solo === i;
      slots[i] = {
        cx: (W - span) / 2 + ((j + 0.5) * span) / count,
        base: H * (row === 0 ? 0.53 : 0.43) - (st.mode === "title" ? H * 0.55 : 0),
        boxW: (span / count) * 0.9,
        boxH: H * (row === 0 ? 0.13 : 0.16) * (solo ? 1.15 : 1),
        o: st.mode === "title" ? 0 : row === 0 ? 0.92 : 1,
        z: row === 0 ? 2 : solo ? 4 : 3,
        role: solo ? "solo" : "line",
      };
    }
    return slots;
  }
  const span = portrait ? W * 0.94 : st.credits ? W * 0.56 : W * 0.9;
  const left = portrait ? (W - span) / 2 : st.credits ? W * 0.04 : (W - span) / 2;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i += 1) {
    const off = mid > 0 ? Math.abs(i - mid) / mid : 0;
    const solo = st.solo === i;
    const boxH = (portrait ? H * 0.2 : st.credits ? H * 0.32 : H * 0.48) * (1 - off * 0.14) * (solo ? 1.16 : 1);
    slots[i] = {
      cx: left + ((i + 0.5) * span) / n,
      base: (portrait ? H * 0.44 : H * 0.04) + off * H * 0.025,
      boxW: (span / n) * 0.9 * (solo ? 1.12 : 1),
      boxH,
      o: st.mode === "title" ? 0 : 1,
      z: solo ? 4 : 3,
      role: solo ? "solo" : "line",
    };
    if (st.mode === "title") slots[i].base -= H * 0.55;
  }
  return slots;
}

type Cur = { cx: number; base: number; s: number; o: number; init: boolean };

/**
 * The band on stage: every cutout, the frontman large and lit, the rest performing on the beat.
 * Positions glide (critically damped) and poses are pure functions of the beat clock; both are written
 * straight to transforms from one rAF loop so React only renders when the tape or viewport changes.
 */
export const Stage = memo(function Stage({
  tape,
  theme,
  live,
  W,
  H,
  reduced,
}: {
  tape: Tape;
  theme: Theme;
  /** written by the video every frame; read by the loop */
  live: MutableRefObject<StageState>;
  W: number;
  H: number;
  reduced: boolean;
}) {
  const n = tape.photos.length;
  const [aspects, setAspects] = useState<number[]>(() => tape.photos.map(guessAspect));
  useEffect(() => setAspects(tape.photos.map(guessAspect)), [tape]);
  const stRef = live;
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const shadows = useRef<(HTMLDivElement | null)[]>([]);
  const spot = useRef<HTMLDivElement | null>(null);
  const cur = useRef<Cur[]>([]);
  const roles = useRef<string[]>([]);
  const portrait = H > W * 1.05;
  const baseH = Math.round(H * (portrait ? 0.36 : 0.72));
  const dims = useMemo(() => aspects.map((a) => ({ w: Math.round(baseH * a), h: baseH })), [aspects, baseH]);
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const env = useRef({ W, H, portrait, reduced, variant: theme.variant, pixel: theme.pixel, lift: theme.lift });
  env.current = { W, H, portrait, reduced, variant: theme.variant, pixel: theme.pixel, lift: theme.lift };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = stRef.current;
      const { W: w, H: h, portrait: pt, reduced: rd, variant, pixel, lift } = env.current;
      const slots = layout(st, n, w, h, pt);
      if (!pt && lift > 0)
        for (const sl of slots) {
          sl.base += lift * h;
          sl.boxH *= 1 - lift;
        }
      const beats = (st.t * st.bpm) / 60;
      const k = 1 - Math.exp(-dt * (rd ? 5 : 7.5));
      const amp = rd ? 0.3 : 1;
      let frontX: number | null = null;
      let frontW = 0;
      for (let i = 0; i < n; i += 1) {
        const el = nodes.current[i];
        const sl = slots[i];
        const d = dimsRef.current[i];
        if (!el || !sl || !d) continue;
        const target = Math.min(sl.boxH / d.h, sl.boxW / d.w);
        let c = cur.current[i];
        if (!c) {
          c = { cx: sl.cx, base: sl.base - h * 0.5, s: target, o: 0, init: true };
          cur.current[i] = c;
        }
        c.cx += (sl.cx - c.cx) * k;
        c.base += (sl.base - c.base) * k;
        c.s += (target - c.s) * k;
        c.o += (sl.o - c.o) * k;
        const dispH = d.h * c.s;
        const p = pose(variant, beats, i, sl.role === "front", st.t);
        let x = c.cx - d.w / 2 + p.x * dispH * amp;
        let y = -c.base + p.y * dispH * amp;
        if (pixel) {
          const q = Math.max(3, Math.round(h / 180));
          x = Math.round(x / q) * q;
          y = Math.round(y / q) * q;
        }
        const sx = c.s * (1 + (p.sx - 1) * amp);
        const sy = c.s * (1 + (p.sy - 1) * amp);
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(p.r * amp).toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
        el.style.opacity = c.o.toFixed(3);
        if (roles.current[i] !== sl.role) {
          roles.current[i] = sl.role;
          el.dataset.role = sl.role;
          el.style.zIndex = String(sl.z);
        }
        const sh = shadows.current[i];
        if (sh) {
          const lift = Math.max(0, -p.y * amp);
          const sw = d.w * c.s * 0.9;
          sh.style.transform = `translate3d(${(c.cx - 50).toFixed(1)}px, ${(-c.base + 14).toFixed(1)}px, 0) scale(${(sw / 100).toFixed(3)}, ${(1 - lift * 3).toFixed(3)})`;
          sh.style.opacity = (c.o * (1 - lift * 4)).toFixed(3);
        }
        if (sl.role === "front" || sl.role === "solo") {
          frontX = c.cx;
          frontW = d.w * c.s;
        }
      }
      if (spot.current) {
        const s = spot.current;
        if (frontX == null) s.style.opacity = "0";
        else {
          s.style.opacity = "1";
          s.style.transform = `translate3d(${(frontX - 50).toFixed(1)}px, 0, 0) scaleX(${(Math.max(frontW, w * 0.12) / 100).toFixed(3)})`;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [n]);

  const setAspect = (i: number, a: number) =>
    setAspects((prev) => {
      if (!a || !Number.isFinite(a) || Math.abs(prev[i] - a) < 0.01) return prev;
      const next = prev.slice();
      next[i] = Math.max(0.3, Math.min(3, a));
      return next;
    });

  return (
    <div className="vs" aria-hidden="true">
      <div className="vs-spot" ref={spot} />
      {tape.photos.map((_, i) => (
        <div key={`sh${i}`} className="vs-shadow" ref={(el) => (shadows.current[i] = el)} />
      ))}
      {tape.photos.map((p, i) => {
        const d = dims[i];
        const art = p.performer || p.motion || p.cutout;
        return (
          <div
            key={i}
            className="vm"
            data-role="line"
            data-slot={i}
            ref={(el) => (nodes.current[i] = el)}
            style={{ width: d.w, height: d.h }}
          >
            <div className="vm-body">
              {art ? (
                theme.pixel ? (
                  <Pixel src={art} rows={56} levels={5} className="vm-img vm-px" onAspect={(a) => setAspect(i, a)} />
                ) : (
                  <img
                    className="vm-img"
                    src={art}
                    alt=""
                    draggable={false}
                    decoding="async"
                    onLoad={(e) => setAspect(i, e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                  />
                )
              ) : (
                <Card photo={p} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

/** no cutout: the hero, cropped out of the photo by its box */
function Card({ photo }: { photo: Photo }) {
  const b = photo.box;
  const style: React.CSSProperties = { backgroundImage: `url("${photo.src}")` };
  if (b) {
    const w = Math.max(0.05, b[2] - b[0]);
    const h = Math.max(0.05, b[3] - b[1]);
    style.backgroundSize = `${100 / w}% ${100 / h}%`;
    style.backgroundPosition = `${w < 1 ? (b[0] / (1 - w)) * 100 : 50}% ${h < 1 ? (b[1] / (1 - h)) * 100 : 50}%`;
  }
  return <div className="vm-img vm-card" style={style} />;
}
