import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Photo, Tape } from "../../lib/types";
import { camera, compose, freezeHold, type Take } from "./direct";
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
  /** the director's take on screen; null for tapes without a shot list (the fixed layout above) */
  take: Take | null;
  /** the roll call: member i walks on at from + i * step */
  roll?: { from: number; step: number } | null;
};

/** layers behind the band that the camera also moves, with less depth */
export type CameraLayers = { bd: HTMLElement | null; vf: HTMLElement | null };

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
      // phones and the shareable MP4 (9:16): the band fills the frame above the lyrics, not a cluster in the middle
      const span = W * (row === 0 ? 0.9 : 1.02);
      const solo = st.solo === i;
      slots[i] = {
        cx: (W - span) / 2 + ((j + 0.5) * span) / count,
        base: H * (row === 0 ? 0.55 : 0.39) - (st.mode === "title" ? H * 0.55 : 0),
        boxW: (span / count) * 0.96,
        boxH: H * (row === 0 ? 0.18 : 0.23) * (solo ? 1.15 : 1),
        o: st.mode === "title" ? 0 : row === 0 ? 0.92 : 1,
        z: row === 0 ? 2 : solo ? 4 : 3,
        role: solo ? "solo" : "line",
      };
    }
    return rollCall(st, slots, H);
  }
  const span = portrait ? W * 0.94 : st.credits ? W * 0.56 : W * 0.9;
  const left = portrait ? (W - span) / 2 : st.credits ? W * 0.04 : (W - span) / 2;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i += 1) {
    const off = mid > 0 ? Math.abs(i - mid) / mid : 0;
    const solo = st.solo === i;
    const boxH = (portrait ? H * 0.27 : st.credits ? H * 0.32 : H * 0.48) * (1 - off * 0.14) * (solo ? 1.16 : 1);
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
  return rollCall(st, slots, H);
}

/** before their beat in the roll call a member waits below the stage */
function rollCall(st: StageState, slots: Slot[], H: number): Slot[] {
  if (!st.roll) return slots;
  const { from, step } = st.roll;
  slots.forEach((s, i) => {
    if (st.t < from + i * step) {
      s.o = 0;
      s.base -= H * 0.55;
    }
  });
  return slots;
}

type Cur = { cx: number; base: number; s: number; o: number; init: boolean };

const ECHO = 2;

/**
 * The band on stage: every cutout, the frontman large and lit, the rest performing on the beat.
 * Positions glide (critically damped) and poses are pure functions of the beat clock; both are written
 * straight to transforms from one rAF loop so React only renders when the tape or viewport changes.
 */
export const Stage = memo(function Stage({
  tape,
  theme,
  live,
  layers,
  W,
  H,
  reduced,
}: {
  tape: Tape;
  theme: Theme;
  /** written by the video every frame; read by the loop */
  live: MutableRefObject<StageState>;
  layers: MutableRefObject<CameraLayers>;
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
  const ghosts = useRef<(HTMLDivElement | null)[]>([]);
  const dimEl = useRef<HTMLDivElement | null>(null);
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
    let lastTake = -1;
    let directed = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = stRef.current;
      const { W: w, H: h, portrait: pt, reduced: rd, variant, pixel, lift } = env.current;
      const k = 1 - Math.exp(-dt * (rd ? 5 : 7.5));
      const amp = rd ? 0.3 : 1;
      const q = pixel ? Math.max(3, Math.round(h / 180)) : 0;
      const L = layers.current;

      if (st.take) {
        // ---- directed: the shot list decides the frame, the camera performs the move ----
        directed = true;
        const take = st.take;
        const comp = compose(take, n, w, h, pt, st.credits);
        if (!pt && lift > 0)
          for (const p of comp.places)
            if (p) {
              p.base += lift * h;
              p.boxH *= 1 - lift;
            }
        const frozen = take.fx === "freeze" && st.t - take.from < freezeHold(st.bpm);
        const tt = frozen ? take.from + 0.001 : st.t;
        const cam = camera(take, tt, st.bpm, w, h, rd);
        const beats = (tt * st.bpm) / 60;
        const snap = take.index !== lastTake && (take.cut || lastTake < 0);
        lastTake = take.index;
        const fx = comp.focusX;
        const fy = comp.focusY;
        const cr = (cam.r * Math.PI) / 180;
        const cos = Math.cos(cr);
        const sin = Math.sin(cr);
        const place = (ax: number, ay: number, depth: number) => {
          const ux = (ax - fx) * cam.S;
          const uy = (ay - fy) * cam.S;
          return {
            x: fx + ux * cos - uy * sin + cam.dx + cam.orbit * w * 0.07 * (depth * 2 - 1),
            y: fy + ux * sin + uy * cos + cam.dy,
          };
        };
        let spotX: number | null = null;
        let spotW = 0;
        for (let i = 0; i < n; i += 1) {
          const el = nodes.current[i];
          const d = dimsRef.current[i];
          if (!el || !d) continue;
          const pl = comp.places[i];
          let c = cur.current[i];
          const target = pl ? Math.min(pl.boxH / d.h, pl.boxW / d.w) : c ? c.s : 0.3;
          if (!c) {
            c = { cx: pl ? pl.cx : w / 2, base: pl ? pl.base : 0, s: target, o: 0, init: true };
            cur.current[i] = c;
          }
          if (pl && (snap || c.o < 0.02)) {
            // a cut: the new frame is simply there
            c.cx = pl.cx;
            c.base = pl.base;
            c.s = target;
          } else if (pl) {
            c.cx += (pl.cx - c.cx) * k;
            c.base += (pl.base - c.base) * k;
            c.s += (target - c.s) * k;
          }
          const o = pl ? 1 : 0;
          c.o = snap ? o : c.o + (o - c.o) * Math.min(1, k * 2.5);
          const depth = pl ? pl.depth : 0.5;
          const role = pl ? pl.role : "back";
          const dispH = d.h * c.s;
          const p = pose(variant, beats, i, role === "front", tt);
          const at = place(c.cx + p.x * dispH * amp, h - c.base + p.y * dispH * amp, depth);
          let x = at.x - d.w / 2;
          let y = at.y - h;
          if (q) {
            x = Math.round(x / q) * q;
            y = Math.round(y / q) * q;
          }
          const S = c.s * cam.S;
          const sx = S * (1 + (p.sx - 1) * amp) * (pl?.mirror ? -1 : 1);
          const sy = S * (1 + (p.sy - 1) * amp) * (pl?.stretch ?? 1);
          const rot = p.r * amp * (pl?.mirror ? -1 : 1) + cam.r;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
          el.style.opacity = c.o.toFixed(3);
          const z = String(2 + Math.round(depth * 6));
          if (roles.current[i] !== role + z) {
            roles.current[i] = role + z;
            el.dataset.role = role;
            el.style.zIndex = z;
          }
          // echo: two lagging copies trail the subject
          for (let g = 1; g <= ECHO; g += 1) {
            const gh = ghosts.current[i * ECHO + g - 1];
            if (!gh) continue;
            const on = take.fx === "echo" && pl && !rd;
            if (!on) {
              if (gh.style.display !== "none") gh.style.display = "none";
              continue;
            }
            if (gh.style.display !== "block") gh.style.display = "block";
            const tg = tt - g * 0.13;
            const pg = pose(variant, (tg * st.bpm) / 60, i, role === "front", tg);
            const ag = place(c.cx + pg.x * dispH + (g * (i % 2 === 0 ? -1 : 1) * w * 0.022), h - c.base + pg.y * dispH, depth);
            gh.style.transform = `translate3d(${(ag.x - d.w / 2).toFixed(1)}px, ${(ag.y - h).toFixed(1)}px, 0) rotate(${(pg.r + cam.r).toFixed(2)}deg) scale(${(S * (1 + g * 0.03) * (pl?.mirror ? -1 : 1)).toFixed(4)}, ${(S * (1 + g * 0.03) * (pl?.stretch ?? 1)).toFixed(4)})`;
            gh.style.opacity = (c.o * (g === 1 ? 0.42 : 0.2)).toFixed(3);
            gh.style.zIndex = String(1 + Math.round(depth * 6));
          }
          const sh = shadows.current[i];
          if (sh) {
            const lifted = Math.max(0, -p.y * amp);
            const foot = place(c.cx, h - c.base, depth);
            const sw = d.w * S * 0.9;
            sh.style.transform = `translate3d(${(foot.x - 50).toFixed(1)}px, ${(foot.y - h + 14).toFixed(1)}px, 0) scale(${(sw / 100).toFixed(3)}, ${(1 - lifted * 3).toFixed(3)})`;
            sh.style.opacity = (c.o * (1 - lifted * 4) * (pl && pl.base < 0 ? 0 : 1)).toFixed(3);
          }
          if (comp.spot === i) {
            spotX = at.x;
            spotW = d.w * S;
          }
        }
        if (spot.current) {
          const s = spot.current;
          if (spotX == null) s.style.opacity = "0";
          else {
            s.style.opacity = "1";
            s.style.transform = `translate3d(${(spotX - 50).toFixed(1)}px, 0, 0) scaleX(${(Math.max(spotW, w * 0.14) / 100).toFixed(3)})`;
          }
        }
        if (dimEl.current) {
          const dm = dimEl.current;
          dm.style.opacity = spotX == null ? "0" : "1";
          if (spotX != null) dm.style.setProperty("--sx", `${spotX.toFixed(0)}px`);
        }
        // the world behind moves less: parallax by depth
        const over = 0.05;
        if (L.bd) {
          L.bd.style.transformOrigin = `${(fx + w * over).toFixed(0)}px ${(fy + h * over).toFixed(0)}px`;
          L.bd.style.transform = `translate3d(${(cam.dx * 0.3 - cam.orbit * w * 0.035).toFixed(1)}px, ${(cam.dy * 0.3 + cam.horizon).toFixed(1)}px, 0) rotate(${(cam.r * 0.5).toFixed(2)}deg) scale(${(1 + (cam.S - 1) * 0.35).toFixed(4)})`;
        }
        if (L.vf) {
          L.vf.style.transformOrigin = `${fx.toFixed(0)}px ${fy.toFixed(0)}px`;
          L.vf.style.transform = `translate3d(${(cam.dx * 0.6 - cam.orbit * w * 0.015).toFixed(1)}px, ${(cam.dy * 0.6 + cam.horizon * 0.5).toFixed(1)}px, 0) rotate(${(cam.r * 0.7).toFixed(2)}deg) scale(${(1.04 + (cam.S - 1) * 0.6).toFixed(4)})`;
        }
        return;
      }

      // ---- no shot list: the fixed layout (frontman and back row) ----
      if (directed) {
        directed = false;
        lastTake = -1;
        if (L.bd) L.bd.style.transform = "";
        if (L.vf) L.vf.style.transform = "";
        if (dimEl.current) dimEl.current.style.opacity = "0";
        ghosts.current.forEach((g) => g && (g.style.display = "none"));
      }
      const slots = layout(st, n, w, h, pt);
      if (!pt && lift > 0)
        for (const sl of slots) {
          sl.base += lift * h;
          sl.boxH *= 1 - lift;
        }
      const beats = (st.t * st.bpm) / 60;
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
        if (q) {
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
          const lifted = Math.max(0, -p.y * amp);
          const sw = d.w * c.s * 0.9;
          sh.style.transform = `translate3d(${(c.cx - 50).toFixed(1)}px, ${(-c.base + 14).toFixed(1)}px, 0) scale(${(sw / 100).toFixed(3)}, ${(1 - lifted * 3).toFixed(3)})`;
          sh.style.opacity = (c.o * (1 - lifted * 4)).toFixed(3);
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

  const art = (p: Photo, i: number, ghost: boolean) => {
    const src = p.performer || p.motion || p.cutout;
    if (!src) return <Card photo={p} />;
    if (theme.pixel) return <Pixel src={src} rows={56} levels={5} className="vm-img vm-px" onAspect={ghost ? undefined : (a) => setAspect(i, a)} />;
    return (
      <img
        className="vm-img"
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        onLoad={ghost ? undefined : (e) => setAspect(i, e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
      />
    );
  };

  return (
    <div className="vs" aria-hidden="true">
      <div className="vs-dim" ref={dimEl} />
      <div className="vs-spot" ref={spot} />
      {tape.photos.map((_, i) => (
        <div key={`sh${i}`} className="vs-shadow" ref={(el) => (shadows.current[i] = el)} />
      ))}
      {tape.photos.map((p, i) =>
        Array.from({ length: ECHO }, (_, g) => (
          <div
            key={`g${i}-${g}`}
            className="vm vm-ghost"
            data-g={g + 1}
            ref={(el) => (ghosts.current[i * ECHO + g] = el)}
            style={{ width: dims[i].w, height: dims[i].h, display: "none" }}
          >
            <div className="vm-body">{art(p, i, true)}</div>
          </div>
        )),
      )}
      {tape.photos.map((p, i) => (
        <div
          key={i}
          className="vm"
          data-role="line"
          data-slot={i}
          ref={(el) => (nodes.current[i] = el)}
          style={{ width: dims[i].w, height: dims[i].h }}
        >
          <div className="vm-body">{art(p, i, false)}</div>
        </div>
      ))}
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
