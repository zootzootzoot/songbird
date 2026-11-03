import type { CameraMove, Shot, ShotFx, ShotKind, Tape } from "../../lib/types";
import { hash, type Timeline } from "./schedule";

/**
 * The director's shot list, performed. Muse Spark writes one Shot per lyric line plus an intro and an outro
 * (tape.direction); this turns it into takes on the song clock (cut on the beat at or before each line),
 * a composition per take (who is in frame, how big, where) and a virtual camera per take (the move).
 * Everything here is a pure function of the take and the clock, so seeking lands on the right frame.
 */

export type Take = {
  /** position in the plan */
  index: number;
  /** cue index; -1 the intro, -2 the outro */
  cue: number;
  shot: ShotKind;
  subjects: number[];
  move: CameraMove;
  fx: ShotFx;
  /** where a single subject stands: 0 left (lyrics right), 1 right (lyrics left) */
  side: 0 | 1;
  /** which of the shot's formations */
  variant: number;
  from: number;
  to: number;
  /** the composition changed from the previous take: hard cut instead of a glide */
  cut: boolean;
};

const KINDS: ShotKind[] = ["close-up", "two-shot", "wide", "solo", "lineup", "photo", "low-angle"];
const MOVES: CameraMove[] = ["static", "push-in", "pull-out", "pan-left", "pan-right", "orbit", "handheld", "snap-zoom", "crane-up"];
const FXS: ShotFx[] = ["none", "strobe", "freeze", "echo", "split", "spotlight", "flash"];
export const SINGLE: ShotKind[] = ["close-up", "solo", "low-angle", "photo"];

function clean(s: Partial<Shot> | undefined, n: number, fallback: number | null, everyone: boolean): Shot {
  const shot: ShotKind = KINDS.includes(s?.shot as ShotKind) ? (s!.shot as ShotKind) : everyone ? "wide" : "close-up";
  const move: CameraMove = MOVES.includes(s?.move as CameraMove) ? (s!.move as CameraMove) : "static";
  const fx: ShotFx = FXS.includes(s?.fx as ShotFx) ? (s!.fx as ShotFx) : "none";
  let subjects = Array.isArray(s?.subjects)
    ? [...new Set(s!.subjects.filter((i) => Number.isInteger(i) && i >= 0 && i < n))]
    : [];
  const all = Array.from({ length: n }, (_, i) => i);
  if (shot === "wide" || shot === "lineup") {
    if (subjects.length < 2) subjects = all;
  } else if (!subjects.length) subjects = [fallback != null && fallback < n ? fallback : 0];
  if (shot === "two-shot" && subjects.length < 2 && n > 1) subjects = [subjects[0], subjects[0] === 0 ? 1 : 0];
  return { shot, subjects, move, fx };
}

export function plan(tape: Tape, tl: Timeline, bpm: number): Take[] | null {
  const d = tape.direction;
  const n = tape.photos.length;
  if (!d || !Array.isArray(d.shots) || !n) return null;
  const spb = 60 / bpm;
  // the beat at or just before t: cuts land on the grid, never late
  const snap = (t: number) => Math.max(0, Math.floor((t + 0.03) / spb) * spb);
  const raw: { cue: number; shot: Shot; at: number }[] = [];
  raw.push({ cue: -1, shot: clean(d.intro, n, null, true), at: 0 });
  const introEnd = snap(tl.titleEnd);
  tl.cues.forEach((c, ci) => {
    raw.push({ cue: ci, shot: clean(d.shots[c.line], n, c.photo, c.chorus), at: Math.max(introEnd, snap(c.start - 0.05)) });
  });
  const last = tl.cues[tl.cues.length - 1];
  raw.push({ cue: -2, shot: clean(d.outro, n, null, true), at: snap(Math.max(tl.creditsStart, last ? last.until : 0)) });

  // keep it monotonic; when two lines cut on the same beat the later one wins
  const kept: typeof raw = [];
  for (const r of raw) {
    while (r.cue !== -2 && kept.length > 1 && r.at <= kept[kept.length - 1].at) kept.pop();
    if (kept.length && r.at <= kept[kept.length - 1].at) r.at = kept[kept.length - 1].at + spb;
    kept.push(r);
  }

  const takes: Take[] = [];
  let side: 0 | 1 = hash(tape.id) < 0.5 ? 0 : 1;
  let lastSingle: number | null = null;
  kept.forEach((r, i) => {
    const s = r.shot;
    if (SINGLE.includes(s.shot) || (s.fx === "split" && s.subjects.length === 1)) {
      if (s.subjects[0] !== lastSingle) side = side === 0 ? 1 : 0;
      lastSingle = s.subjects[0];
    }
    const variant = Math.floor(hash(`${tape.id}:${r.cue}:${s.shot}`) * 3) % 3;
    const prev = takes[takes.length - 1];
    const take: Take = {
      index: i,
      cue: r.cue,
      shot: s.shot,
      subjects: s.subjects,
      move: s.move,
      fx: s.fx,
      side,
      variant,
      from: r.at,
      to: i + 1 < kept.length ? kept[i + 1].at : Infinity,
      cut: true,
    };
    if (prev) {
      const same =
        prev.shot === take.shot &&
        prev.side === take.side &&
        prev.variant === take.variant &&
        prev.fx !== "split" &&
        take.fx !== "split" &&
        prev.subjects.join() === take.subjects.join();
      take.cut = !same;
    }
    takes.push(take);
  });
  return takes;
}

export function takeAt(takes: Take[], t: number): number {
  let lo = 0;
  let hi = takes.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (takes[mid].from <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** the freeze-frame holds this long from the cut */
export function freezeHold(bpm: number) {
  return Math.max(1.2, (2 * 60) / bpm);
}

export type Place = {
  cx: number;
  base: number;
  boxW: number;
  boxH: number;
  /** 0 far .. 1 near: parallax in an orbit, stacking order */
  depth: number;
  mirror: boolean;
  /** extra vertical stretch (the low angle) */
  stretch: number;
  role: "front" | "solo" | "line" | "back";
};

export type Composition = {
  places: (Place | null)[];
  /** what the camera frames */
  focusX: number;
  focusY: number;
  /** where the lyrics go: beside a single subject, or over the top of a group */
  lyric: "verse" | "lineup";
  /** the subject who gets the spotlight cone, if any */
  spot: number | null;
};

/**
 * Who is in frame, how big and where. Sizes are boxes the art is fitted into (performers have their own
 * aspect). `credits` reserves the right-hand column for the roll; `portrait` stacks band over lyrics.
 */
export function compose(take: Take, n: number, W: number, H: number, portrait: boolean, credits: boolean): Composition {
  const places: (Place | null)[] = Array.from({ length: n }, () => null);
  const x0 = 0;
  const fw = credits && !portrait ? W * 0.6 : W;
  const subj = take.subjects.filter((i) => i < n);
  const at = (f: number) => x0 + fw * f;
  const P = (cx: number, base: number, boxW: number, boxH: number, depth: number, role: Place["role"], mirror = false, stretch = 1): Place => ({
    cx,
    base,
    boxW,
    boxH,
    depth,
    mirror,
    stretch,
    role,
  });
  let lyric: Composition["lyric"] = "lineup";
  let spot: number | null = null;
  const sideX = (near: number) => (take.side === 0 ? near : 1 - near);

  if (take.fx === "split" && !portrait) {
    // split screen: two members in two panels, or one member beside their own photo
    if (subj.length >= 2) {
      places[subj[0]] = P(at(0.25), H * 0.03, fw * 0.4, H * 0.6, 0.8, "front");
      places[subj[1]] = P(at(0.75), H * 0.03, fw * 0.4, H * 0.6, 0.8, "front", true);
    } else places[subj[0]] = P(at(0.75), H * 0.03, fw * 0.42, H * 0.62, 0.8, "front");
  } else if (SINGLE.includes(take.shot)) {
    const s = subj[0];
    lyric = "verse";
    if (portrait) {
      const size = { "close-up": 0.46, "low-angle": 0.44, solo: 0.34, photo: 0.34 }[take.shot as "close-up"] ?? 0.36;
      const base = take.shot === "close-up" ? H * 0.38 : H * 0.43;
      places[s] = P(W * 0.5, base, W * 0.9, H * size, 1, take.shot === "solo" ? "solo" : "front", false, take.shot === "low-angle" ? 1.08 : 1);
    } else if (take.shot === "close-up") {
      // fills the frame, cropped at the waist
      places[s] = P(at(sideX(0.29)), -H * 0.16, fw * 0.54, H * 1.08, 1, "front");
    } else if (take.shot === "low-angle") {
      places[s] = P(at(sideX(0.3)), -H * 0.05, fw * 0.5, H * 0.92, 1, "front", false, 1.08);
    } else if (take.shot === "solo") {
      places[s] = P(at(sideX(0.33)), H * 0.05, fw * 0.4, H * 0.64, 0.85, "solo");
    } else {
      places[s] = P(at(sideX(0.3)), H * 0.03, fw * 0.42, H * 0.7, 0.9, "front");
    }
    if (take.shot === "solo") spot = s;
  } else if (take.shot === "two-shot") {
    const [a, b] = subj;
    if (portrait) {
      places[a] = P(W * 0.3, H * 0.43, W * 0.46, H * 0.28, 0.9, "front");
      if (b != null) places[b] = P(W * 0.7, H * 0.43, W * 0.46, H * 0.28, 0.9, "front", take.variant === 1);
    } else if (take.variant === 0) {
      // a duet, shoulder to shoulder
      places[a] = P(at(0.37), H * 0.03, fw * 0.32, H * 0.58, 0.9, "front");
      if (b != null) places[b] = P(at(0.63), H * 0.03, fw * 0.32, H * 0.58, 0.8, "front");
    } else if (take.variant === 1) {
      // a stand-off, facing each other across the stage
      places[a] = P(at(0.2), H * 0.03, fw * 0.34, H * 0.62, 0.9, "front");
      if (b != null) places[b] = P(at(0.8), H * 0.03, fw * 0.34, H * 0.62, 0.9, "front", true);
    } else {
      // one near, one over their shoulder
      places[a] = P(at(0.3), -H * 0.04, fw * 0.4, H * 0.74, 1, "front");
      if (b != null) places[b] = P(at(0.7), H * 0.12, fw * 0.3, H * 0.44, 0.35, "front");
    }
  } else if (take.shot === "lineup" || portrait) {
    const k = subj.length;
    if (portrait && k > 3) {
      const back = Math.ceil(k / 2);
      subj.forEach((s, i) => {
        const row = i < back ? 0 : 1;
        const count = row === 0 ? back : k - back;
        const j = row === 0 ? i : i - back;
        const span = W * (row === 0 ? 0.86 : 0.94);
        places[s] = P((W - span) / 2 + ((j + 0.5) * span) / count, H * (row === 0 ? 0.53 : 0.43), (span / count) * 0.9, H * (row === 0 ? 0.13 : 0.16), row === 0 ? 0.3 : 0.8, "line");
      });
    } else {
      const span = portrait ? W * 0.94 : fw * 0.92;
      const left = x0 + (fw - span) / 2;
      subj.forEach((s, i) => {
        places[s] = P(left + ((i + 0.5) * span) / k, portrait ? H * 0.44 : H * 0.03, (span / k) * 0.92, portrait ? H * 0.2 : H * 0.5, 0.6, "line");
      });
    }
  } else {
    // wide: the whole stage, in one of three formations
    const k = subj.length;
    const mid = (k - 1) / 2;
    subj.forEach((s, i) => {
      const off = mid > 0 ? (i - mid) / mid : 0;
      if (take.variant === 0) {
        // an arc: the middle stands back and up
        const a = Math.abs(off);
        places[s] = P(at(0.08 + (0.84 * (i + 0.5)) / k), H * (0.13 - a * 0.1), (fw * 0.86) / k, H * (0.36 + a * 0.07), 0.3 + a * 0.6, "line");
      } else if (take.variant === 1) {
        // two tiers on risers
        const back = i % 2 === 0;
        places[s] = P(at(0.1 + (0.8 * (i + 0.5)) / k), back ? H * 0.17 : H * 0.02, (fw * 0.98) / k, back ? H * 0.32 : H * 0.42, back ? 0.25 : 0.85, "line");
      } else {
        // a diagonal, far left to near right
        const f = k > 1 ? i / (k - 1) : 0.5;
        places[s] = P(at(0.12 + 0.76 * f), H * (0.2 - f * 0.18), (fw * 0.84) / k, H * (0.26 + f * 0.22), 0.2 + f * 0.8, "line");
      }
    });
  }
  if (take.fx === "spotlight") spot = subj[0] ?? null;

  // frame the subjects
  let minX = Infinity;
  let maxX = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of places) {
    if (!p) continue;
    minX = Math.min(minX, p.cx - p.boxW / 2);
    maxX = Math.max(maxX, p.cx + p.boxW / 2);
    top = Math.min(top, H - p.base - p.boxH);
    bottom = Math.max(bottom, H - p.base);
  }
  const focusX = Number.isFinite(minX) ? (minX + maxX) / 2 : W / 2;
  const focusY = Number.isFinite(top) ? Math.max(H * 0.2, Math.min(H * 0.8, top + (bottom - top) * 0.4)) : H / 2;
  return { places, focusX, focusY, lyric, spot };
}

export type Camera = {
  /** zoom about the focus */
  S: number;
  dx: number;
  dy: number;
  /** roll, degrees */
  r: number;
  /** -1..1 orbit swing: near layers travel further than far ones */
  orbit: number;
  /** backdrop drop for the low angle (horizon goes down) */
  horizon: number;
};

const easeInOut = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/** the move, executed over the take (capped so held shots in long gaps still travel) */
export function camera(take: Take, t: number, bpm: number, W: number, H: number, reduced: boolean): Camera {
  const spb = 60 / bpm;
  const span = Math.max(1, Math.min(take.to - take.from, 14));
  const p = Math.max(0, Math.min(1, (t - take.from) / span));
  const amp = reduced ? 0.35 : 1;
  const c: Camera = { S: 1, dx: 0, dy: 0, r: 0, orbit: 0, horizon: 0 };
  switch (take.move) {
    case "push-in":
      c.S = 1 + 0.2 * easeOut(p) * amp;
      break;
    case "pull-out":
      c.S = 1 + 0.24 * (1 - easeOut(p)) * amp;
      break;
    case "pan-left":
    case "pan-right": {
      const dir = take.move === "pan-left" ? 1 : -1;
      c.S = 1 + 0.08 * amp;
      c.dx = dir * W * 0.07 * (easeInOut(p) * 2 - 1) * amp;
      break;
    }
    case "orbit":
      c.S = 1 + 0.06 * amp;
      c.orbit = -Math.cos(Math.PI * p) * amp;
      c.r = c.orbit * 1.4;
      break;
    case "handheld":
      if (!reduced) {
        c.S = 1.05;
        c.dx = W * 0.006 * (Math.sin(t * 1.7) + 0.6 * Math.sin(t * 4.3 + 1));
        c.dy = H * 0.007 * (Math.sin(t * 2.1 + 2) + 0.5 * Math.sin(t * 5.7));
        c.r = 0.45 * Math.sin(t * 1.3 + 0.5) + 0.2 * Math.sin(t * 3.9);
      }
      break;
    case "snap-zoom": {
      // snaps in on the downbeat of every other bar, back out on the ones between
      const bar = 4 * spb;
      const since = Math.max(0, t - take.from);
      const k = Math.floor(since / bar);
      const into = since - k * bar;
      const to = k % 2 === 0 ? 1.3 : 1;
      const from = k % 2 === 0 ? 1 : 1.3;
      c.S = 1 + (from + (to - from) * Math.min(1, into / 0.09) - 1) * amp;
      break;
    }
    case "crane-up": {
      const e = easeInOut(p);
      c.S = 1 + (0.14 - 0.12 * e) * amp;
      c.dy = H * (-0.07 + 0.13 * e) * amp;
      break;
    }
    default:
      break;
  }
  if (take.shot === "low-angle") {
    c.S *= 1.04;
    c.horizon = H * 0.07;
    c.r += -1.2 * amp;
  }
  return c;
}
