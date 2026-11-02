import { useCallback, useEffect, useRef, useState } from "react";
import { sound } from "./audio";
import type { Tape } from "./types";

/**
 * Plays tape.audio. If the file is missing or the browser refuses it, the deck
 * still "plays" on a clock so the karaoke, reels and bird keep working.
 */
export function usePlayer(tape: Tape | null) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [silent, setSilent] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const failed = useRef(false);
  const clock = useRef<{ startedAt: number; offset: number } | null>(null);
  const raf = useRef(0);
  const duration = tape ? Math.max(tape.duration || 0, tape.lines.length ? tape.lines[tape.lines.length - 1].end + 1 : 0) : 0;
  const durRef = useRef(duration);
  durRef.current = duration;

  // a fresh element per tape
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setTime(0);
    setSilent(false);
    failed.current = false;
    clock.current = null;
    audio.current?.pause();
    audio.current = null;
    if (!tape?.audio) {
      failed.current = true;
      return;
    }
    const el = new Audio();
    el.preload = "auto";
    el.src = tape.audio;
    const onError = () => {
      failed.current = true;
    };
    el.addEventListener("error", onError);
    audio.current = el;
    return () => {
      el.removeEventListener("error", onError);
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [tape]);

  const now = useCallback(() => {
    if (clock.current) return clock.current.offset + (performance.now() - clock.current.startedAt) / 1000;
    if (audio.current && !failed.current) return audio.current.currentTime;
    return time;
  }, [time]);

  const tick = useCallback(() => {
    let t: number;
    let ended = false;
    if (clock.current) {
      t = clock.current.offset + (performance.now() - clock.current.startedAt) / 1000;
      ended = t >= durRef.current;
    } else if (audio.current) {
      t = audio.current.currentTime;
      ended = audio.current.ended;
    } else {
      return;
    }
    if (ended) {
      cancelAnimationFrame(raf.current);
      clock.current = null;
      setPlaying(false);
      setTime(0);
      sound.setDucked(false);
      return;
    }
    setTime(t);
    raf.current = requestAnimationFrame(tick);
  }, []);

  const startClock = useCallback(
    (from: number) => {
      clock.current = { startedAt: performance.now(), offset: from };
      setSilent(true);
      setPlaying(true);
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  const play = useCallback(async () => {
    if (!tape) return;
    sound.setDucked(true);
    const from = time >= durRef.current - 0.2 ? 0 : time;
    const el = audio.current;
    if (el && !failed.current) {
      try {
        el.currentTime = from;
        await el.play();
        clock.current = null;
        setSilent(false);
        setPlaying(true);
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(tick);
        return;
      } catch {
        failed.current = true;
      }
    }
    startClock(from);
  }, [tape, time, tick, startClock]);

  const stop = useCallback(() => {
    const t = now();
    cancelAnimationFrame(raf.current);
    audio.current?.pause();
    clock.current = null;
    setPlaying(false);
    setTime(t);
    sound.setDucked(false);
  }, [now]);

  const seek = useCallback(
    (t: number) => {
      const target = Math.max(0, Math.min(durRef.current - 0.05, t));
      if (clock.current) clock.current = { startedAt: performance.now(), offset: target };
      else if (audio.current && !failed.current) audio.current.currentTime = target;
      setTime(target);
    },
    [],
  );

  const reset = useCallback(() => {
    cancelAnimationFrame(raf.current);
    audio.current?.pause();
    clock.current = null;
    setPlaying(false);
    setTime(0);
    sound.setDucked(false);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return { playing, time, duration, silent, play, stop, seek, reset };
}

export type Player = ReturnType<typeof usePlayer>;

/** index of the line being sung at time t, or -1 between lines */
export function lineAt(tape: Tape | null, t: number): number {
  if (!tape) return -1;
  for (let i = 0; i < tape.lines.length; i += 1) {
    const l = tape.lines[i];
    const next = tape.lines[i + 1];
    // hold the line through the breath before the next one
    const until = next ? Math.min(next.start, l.end + 1.2) : l.end + 1.2;
    if (t >= l.start - 0.15 && t < until) return i;
  }
  return -1;
}

/** the nearest line at or before t, for keeping the right photo forward */
export function lastLineAt(tape: Tape | null, t: number): number {
  if (!tape) return -1;
  let idx = -1;
  tape.lines.forEach((l, i) => {
    if (t >= l.start - 0.15) idx = i;
  });
  return idx;
}
