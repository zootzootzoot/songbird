import type { Variant } from "./themes";
import { hash } from "./schedule";

/**
 * Band choreography. Pure functions of the beat clock, so seeking lands on the right pose.
 * Offsets are in units of the member's displayed height; r in degrees; sx/sy multiply the scale.
 */
export type Pose = { x: number; y: number; r: number; sx: number; sy: number };

const TAU = Math.PI * 2;
const ease = (p: number) => 1 - Math.pow(1 - p, 3);
const expo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

/**
 * @param b beats since the top of the song (fractional)
 * @param k member slot (for call and response)
 * @param front is this member the frontman
 */
export function pose(variant: Variant, b: number, k: number, front: boolean, t: number): Pose {
  const bi = Math.floor(b);
  const ph = b - bi;
  const alt = k % 2 === 0 ? 1 : -1;
  const p: Pose = { x: 0, y: 0, r: 0, sx: 1, sy: 1 };
  switch (variant) {
    case "synthwave":
    case "italo": {
      // a slow cool sway over two beats, a lift on every beat
      const sway = Math.sin((TAU * b) / 2 + k * 0.6);
      p.x = sway * 0.035;
      p.r = sway * 3.2;
      p.y = -Math.pow(Math.abs(Math.sin(Math.PI * b)), 2) * 0.025;
      if (variant === "italo") p.sy = 1 + Math.max(0, Math.cos(TAU * ph)) * 0.025;
      break;
    }
    case "funk":
    case "soul": {
      // step-touch strut: side to side over two beats, a hard pop on the downbeat, lean into the step
      const step = Math.sin(Math.PI * b + k * 0.4);
      const pop = Math.exp(-ph * 7);
      p.x = step * (variant === "funk" ? 0.07 : 0.045);
      p.r = -step * (variant === "funk" ? 6 : 3.5);
      p.y = -pop * 0.04;
      p.sy = 1 - pop * 0.05 + (1 - pop) * 0.01;
      p.sx = 1 + pop * 0.03;
      break;
    }
    case "bigband": {
      // swing: a pendulum over two beats; the section stands up on alternate bars
      const bar = Math.floor(b / 4);
      const swing = Math.sin(Math.PI * b);
      p.r = swing * 4 * alt;
      p.y = -Math.abs(swing) * 0.015 - ((bar + k) % 2 === 0 && !front ? 0.06 * ease(Math.min(1, (b % 4) * 2)) : 0);
      break;
    }
    case "ska": {
      // skank: down on the beat, up on the "and", knees in, alternate the lean every beat
      const up = Math.sin(Math.PI * ph);
      p.y = -Math.pow(up, 1.6) * 0.09;
      p.r = (bi % 2 === 0 ? 1 : -1) * alt * 9 * up;
      p.x = (bi % 2 === 0 ? 1 : -1) * 0.02 * up;
      p.sy = 1 - (1 - up) * 0.07;
      p.sx = 1 + (1 - up) * 0.04;
      break;
    }
    case "hard": {
      // headbang: snap forward on the beat, recover; harder on the downbeat of the bar
      const hit = Math.exp(-ph * 6) * (bi % 4 === 0 ? 1.3 : 1);
      p.r = hit * 9 * (k % 3 === 1 ? -1 : 1);
      p.y = hit * 0.02;
      p.sy = 1 - hit * 0.06;
      p.sx = 1 + hit * 0.03;
      break;
    }
    case "ballad": {
      // wind machine: a long float over two bars, hair-in-the-wind sway
      p.y = -(0.5 + 0.5 * Math.sin((TAU * b) / 8 + k)) * 0.05;
      p.r = Math.sin((TAU * b) / 4 + k * 1.3) * 2.6;
      p.x = Math.sin((TAU * b) / 8 + k * 2) * 0.025;
      break;
    }
    case "punk":
    case "indie": {
      // stop-motion: twelve frames a second, pogo on the beat, a fresh random lean each beat
      const step = Math.floor(t * 12) / 12;
      const sb = (step * b) / Math.max(t, 0.001);
      const sph = sb - Math.floor(sb);
      const jump = Math.sin(Math.PI * sph);
      const rnd = hash(`${bi}`, k) - 0.5;
      if (variant === "punk") {
        p.y = -jump * 0.13;
        p.r = rnd * 16;
        p.x = (hash(`${bi}x`, k) - 0.5) * 0.06;
      } else {
        p.y = -jump * 0.03;
        p.r = rnd * 6;
      }
      break;
    }
    case "rocknroll": {
      // the twist: swivel over two beats, bounce on each
      const tw = Math.sin(Math.PI * b + k * 0.3);
      p.r = tw * 10;
      p.x = -tw * 0.03;
      p.y = -Math.abs(Math.sin(Math.PI * b)) * 0.05;
      p.sy = 1 - Math.abs(tw) * 0.03;
      break;
    }
    case "surf": {
      // riding a swell over a bar
      p.y = Math.sin((TAU * b) / 4 + k * 0.7) * 0.04 - 0.02;
      p.r = Math.sin((TAU * b) / 4 + k * 0.7 + 1.1) * 7;
      p.x = Math.sin((TAU * b) / 8 + k) * 0.03;
      break;
    }
    case "bossa": {
      // a slow sideways sway, barely there
      p.x = Math.sin((TAU * b) / 4 + k * 0.9) * 0.03;
      p.r = Math.sin((TAU * b) / 4 + k * 0.9) * 2;
      p.y = -Math.abs(Math.sin((Math.PI * b) / 2)) * 0.01;
      break;
    }
    case "tango": {
      // staccato: hold a pose, snap to the next on the beat (lean, upright, lean, dip)
      const poses: [number, number, number][] = [
        [-11, 0, -0.03],
        [0, -0.01, 0],
        [11, 0, 0.03],
        [-3, 0.035, 0],
      ];
      const a = poses[(bi + k) % 4];
      const z = poses[(bi + k + 3) % 4];
      const e = expo(Math.min(1, ph / 0.18));
      p.r = z[0] + (a[0] - z[0]) * e;
      p.y = z[1] + (a[1] - z[1]) * e;
      p.x = z[2] + (a[2] - z[2]) * e;
      p.sy = 1 - (bi % 4 === 3 ? 0.04 * e : 0);
      break;
    }
    case "salsa": {
      // hips: figure-of-eight over two beats; step on 1, 2, 3, hold on 4
      const h = (TAU * b) / 2 + k * 0.5;
      p.x = Math.sin(h) * 0.05;
      p.r = Math.sin(h + Math.PI / 2) * 7;
      const hold = bi % 4 === 3;
      p.y = hold ? -0.01 : -Math.sin(Math.PI * ph) * 0.04;
      break;
    }
    case "chip": {
      // two-frame sprite: hop on alternate beats, pixel steps only
      const frame = bi % 2;
      p.y = frame ? -0.07 : 0;
      p.x = ((bi + k) % 4 < 2 ? -1 : 1) * 0.02;
      p.sy = frame ? 1 : 0.95;
      break;
    }
  }
  if (front) {
    p.x *= 0.55;
    p.y *= 0.6;
    p.r *= 0.6;
    p.sx = 1 + (p.sx - 1) * 0.6;
    p.sy = 1 + (p.sy - 1) * 0.6;
  }
  return p;
}

/** 0..1, peaks on the beat and decays; what lights and strobes ride */
export function pulse(b: number) {
  const ph = b - Math.floor(b);
  return Math.exp(-ph * 5);
}
