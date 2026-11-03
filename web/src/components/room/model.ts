import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Stage } from "../../lib/types";
import type { DeckState, TakeState } from "../../lib/useDeck";

/**
 * Everything the control room shows is derived here from the deck's state.
 * Nothing in this file invents model output: it only reads events, counts them
 * and stamps the moment each one reached the room.
 */

export const TAKE_COUNT = 4; // the server records four takes (pipeline.TAKES)
export const IN_KEY = 0.75; // the tuner's cut line (pipeline.IN_KEY)

export const STAGE_INDEX: Record<Stage, number> = {
  looking: 0,
  cutting: 1,
  producing: 2,
  recording: 3,
  listening: 4,
  pressing: 5,
};

export type StepId = "look" | "cast" | "produce" | "record" | "tune" | "ar" | "press";
export type StepState = "idle" | "active" | "done" | "fault";

export const STEPS: { id: StepId; label: string; model: string }[] = [
  { id: "look", label: "LOOK", model: "Muse Spark 1.3" },
  { id: "cast", label: "CAST", model: "SAM 3.1" },
  { id: "produce", label: "PRODUCE", model: "Muse Wonder 1.0" },
  { id: "record", label: "RECORD", model: "ACE-Step 1.5 XL" },
  { id: "tune", label: "TUNE", model: "Demucs" },
  { id: "ar", label: "A&R", model: "Muse Spark 1.2" },
  { id: "press", label: "PRESS", model: "Muse Image 1.0" },
];

const STAGE_STEP: Record<Stage, StepId> = {
  looking: "look",
  cutting: "cast",
  producing: "produce",
  recording: "record",
  listening: "ar",
  pressing: "press",
};

export type Step = { id: StepId; state: StepState; frac: number | null; read: string };

export type TakeView = TakeState & {
  index: number;
  arrived: boolean;
  /** the tuner's call: under the line, or the server said so */
  cut: boolean;
  /** heard by A&R and scored */
  scored: boolean;
  status: "armed" | "rec" | "tuned" | "cut" | "listening" | "heard" | "kept";
};

export type Facts = {
  phase: DeckState["phase"];
  stage: Stage | null;
  stageIdx: number;
  photoN: number;
  seenN: number;
  cutN: number;
  lineN: number;
  bandN: number;
  takesIn: number;
  verdictN: number;
  steps: Record<StepId, Step>;
  takes: TakeView[];
  fault: StepId | null;
};

export function derive(state: DeckState): Facts {
  const w = state.work;
  const phase = state.phase;
  const stage = w.stage;
  const stageIdx = stage ? STAGE_INDEX[stage] : -1;
  const seenN = Object.keys(w.seen).length;
  const cutN = Object.keys(w.cuts).length;
  const lineN = Object.keys(w.lines).length;
  const bandN = Object.keys(w.band).length;
  const photoN = Math.max(state.photos.length, seenN);

  const takes: TakeView[] = [];
  let takesIn = 0;
  let verdictN = 0;
  for (let i = 0; i < TAKE_COUNT; i += 1) {
    const t = w.takes[i] ?? {};
    const arrived = Boolean(t.audio);
    if (arrived) takesIn += 1;
    if (t.verdict !== undefined) verdictN += 1;
    const cut = t.cut ?? (typeof t.inKey === "number" && t.inKey < IN_KEY);
    const scored = t.verdict !== undefined && !t.cut;
    takes.push({ ...t, index: i, arrived, cut: Boolean(cut), scored, status: "armed" });
  }
  // the band records one take at a time: the next empty lane is the one rolling
  const rolling = stage === "recording" && phase === "working" ? takes.findIndex((t) => !t.arrived) : -1;
  for (const t of takes) {
    if (!t.arrived) t.status = t.index === rolling ? "rec" : "armed";
    else if (t.kept) t.status = "kept";
    else if (t.cut) t.status = "cut";
    else if (t.scored) t.status = "heard";
    else if (stage === "listening" && phase === "working") t.status = "listening";
    else t.status = "tuned";
  }

  const s = (id: StepId, state: StepState, frac: number | null = null, read = ""): Step => ({ id, state, frac, read });
  const after = (i: number) => stageIdx > i || phase === "done";
  const at = (i: number) => stageIdx === i;
  const heard = takes.filter((t) => t.arrived && !t.cut).length;

  const steps: Record<StepId, Step> = {
    look: s("look", after(0) ? "done" : at(0) ? "active" : "idle", photoN ? seenN / photoN : null, `${seenN}/${photoN || "-"}`),
    cast:
      stageIdx < 1
        ? s("cast", "idle", null, `0/${seenN || "-"}`)
        : s("cast", seenN > 0 && cutN >= seenN ? "done" : "active", seenN ? cutN / seenN : null, `${cutN}/${seenN}`),
    produce: s("produce", after(2) ? "done" : at(2) ? "active" : "idle", null, lineN ? `${lineN} LN` : ""),
    record: s(
      "record",
      takesIn >= TAKE_COUNT || after(3) ? "done" : at(3) ? "active" : "idle",
      takesIn / TAKE_COUNT,
      `${takesIn}/${TAKE_COUNT}`,
    ),
    tune: s(
      "tune",
      takesIn >= TAKE_COUNT || after(3) ? "done" : at(3) && takesIn > 0 ? "active" : "idle",
      takesIn / TAKE_COUNT,
      `${takes.filter((t) => t.arrived && t.cut).length} CUT`,
    ),
    ar: s("ar", after(4) ? "done" : at(4) ? "active" : "idle", heard ? Math.min(1, verdictN / TAKE_COUNT) : null, `${takes.filter((t) => t.scored).length}/${heard || "-"}`),
    press: s("press", phase === "done" ? "done" : at(5) ? "active" : "idle"),
  };

  let fault: StepId | null = null;
  if (phase === "error") {
    const errStage = state.error?.stage ?? stage;
    fault = errStage ? STAGE_STEP[errStage] : "look";
    if (errStage === "recording" && takesIn > 0) fault = takesIn >= TAKE_COUNT ? "tune" : "record";
    for (const st of Object.values(steps)) if (st.state === "active") st.state = "idle";
    steps[fault].state = "fault";
  }

  return { phase, stage, stageIdx, photoN, seenN, cutN, lineN, bandN, takesIn, verdictN, steps, takes, fault };
}

/* ------------------------------------------------------------------ time */

/** performance.now(), re-rendered at `fps` while `on` */
export function useNow(fps: number, on = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = 0;
    const gap = 1000 / fps;
    const tick = (t: number) => {
      if (t - last >= gap) {
        last = t;
        setNow(performance.now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, on]);
  return now;
}

/**
 * The moment each key first reached the room. Stamping happens during render,
 * keyed and write-once, so a StrictMode double render keeps the first stamp.
 */
export function useStamps() {
  const map = useRef(new Map<string, number>());
  return useMemo(
    () => ({
      /** stamp `key` now unless it already has a stamp; returns the stamp */
      mark(key: string): number {
        let t = map.current.get(key);
        if (t === undefined) {
          t = performance.now();
          map.current.set(key, t);
        }
        return t;
      },
      get(key: string): number | null {
        return map.current.get(key) ?? null;
      },
    }),
    [],
  );
}

export type Stamps = ReturnType<typeof useStamps>;

export function clock(ms: number, tenths = true): string {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tenths ? `.${d}` : ""}`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------- keys */

export const NOTES = "C C# D D# E F F# G G# A A# B".split(" ");
const FLATS: Record<string, string> = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#", CB: "B", FB: "E" };

/** "Eb major" / "F# minor" -> root + mode, or null */
export function parseKey(key: string | null | undefined): { root: number; mode: "major" | "minor" } | null {
  if (!key) return null;
  const m = key.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(maj|major|min|minor|m)?/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2];
  const name = acc === "b" ? FLATS[`${letter}B`] ?? letter : `${letter}${acc}`;
  const root = NOTES.indexOf(name);
  if (root < 0) return null;
  const mode = m[3] && m[3].toLowerCase().startsWith("m") && m[3].toLowerCase() !== "maj" && m[3].toLowerCase() !== "major" ? "minor" : "major";
  return { root, mode };
}

/** the tuner's scale (server/songbird/tuner.py _scale): minor keeps both 7ths */
export function scaleOf(key: string | null | undefined): Set<number> | null {
  const k = parseKey(key);
  if (!k) return null;
  const steps = k.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11];
  return new Set(steps.map((s) => (k.root + s) % 12));
}

/* --------------------------------------------------------------- waveform */

const peaksCache = new Map<string, Promise<Float32Array | null>>();

async function decodePeaks(url: string, bins: number): Promise<Float32Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("html") || type.includes("json")) return null;
    const buf = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 22050);
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const other = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    const out = new Float32Array(bins);
    const per = Math.max(1, Math.floor(ch.length / bins));
    let max = 0;
    for (let b = 0; b < bins; b += 1) {
      let sum = 0;
      const start = b * per;
      const end = Math.min(ch.length, start + per);
      // RMS over the bin, both channels
      for (let i = start; i < end; i += 4) {
        const v = other ? (ch[i] + other[i]) * 0.5 : ch[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / Math.max(1, (end - start) / 4));
      out[b] = rms;
      if (rms > max) max = rms;
    }
    if (max > 0) for (let b = 0; b < bins; b += 1) out[b] /= max;
    return out;
  } catch {
    return null;
  }
}

/** real peaks of a take, decoded in the browser; null while loading or if the file isn't reachable */
export function usePeaks(url: string | null | undefined, bins = 96): { peaks: Float32Array | null; failed: boolean } {
  const [result, setResult] = useState<{ url: string; peaks: Float32Array | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const key = `${url}#${bins}`;
    let p = peaksCache.get(key);
    if (!p) {
      p = decodePeaks(url, bins);
      peaksCache.set(key, p);
    }
    void p.then((peaks) => live && setResult({ url, peaks }));
    return () => {
      live = false;
    };
  }, [url, bins]);
  if (!url || !result || result.url !== url) return { peaks: null, failed: false };
  return { peaks: result.peaks, failed: !result.peaks };
}

/* ----------------------------------------------------------------- layout */

/** natural size of an image or video, for placing SAM's box on a cropped plate */
export function coverPlate(nat: { w: number; h: number } | null): CSSProperties {
  if (!nat || !nat.w || !nat.h) return { inset: 0 };
  const r = nat.w / nat.h;
  if (r >= 1) return { top: 0, bottom: 0, height: "100%", width: `${r * 100}%`, left: `${-((r - 1) / 2) * 100}%` };
  const ir = 1 / r;
  return { left: 0, right: 0, width: "100%", height: `${ir * 100}%`, top: `${-((ir - 1) / 2) * 100}%` };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
