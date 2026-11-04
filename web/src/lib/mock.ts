/**
 * Dev-only `?mock=1`: replays an event stream shaped like a real run of the
 * label pipeline, so working -> done -> play can be exercised without the
 * server. Gated on import.meta.env.DEV by the caller.
 *
 * The sample roll (three pictures and a bath clip) replays SB-0006, which has a
 * moving SAM sticker. Your own photos replay SB-0007's words over your
 * pictures with fake oval stickers.
 *
 * Shape (matches a real run on the GPU server, ~100 s at speed 1): ~8 s looking
 * (every `seen` at once), cutting then straight into producing, SAM's cuts landing
 * during the first seconds of producing, ~40 s producing (a checker note midway;
 * genre, title, lines, band arrive in one burst at the end), ~65 s recording four
 * takes one at a time (each `take` carries the Demucs tuner reading), ~10 s
 * listening (every verdict at once: the takes the tuner cut under 75% in key come
 * back `cut: true`, the rest scored, one kept), a few seconds pressing, done.
 *
 * The fixtures only hold two scored takes; the replay plays them as takes 1 and 3
 * and fills takes 2 and 4 with tuner rejects, so the room always sees four.
 *
 * URL options: `speed=3` (faster), `fail=<stage>`, `takes=<tape id>` (play a real
 * release's four take files from the server as the takes, so the room can draw real waveforms).
 */
import { FIXTURE, MOTION_FIXTURE } from "./api";
import { fakeCutout } from "./image";
import type { SongEvent, Stage, Tape } from "./types";

export function mockSpeed(): number {
  const raw = new URLSearchParams(location.search).get("speed");
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export type MockRun = { cancel: () => void; songSrcs: string[] };

const MOTION_ROLL = ["photo-01", "photo-05", "photo-02", "bath.mp4"];

const LABELS: Record<Stage, string> = {
  looking: "looking at the day",
  cutting: "casting the band",
  producing: "the producer is listening to nothing in particular",
  recording: "recording with the session band",
  listening: "a&r is listening back",
  pressing: "pressing the release",
};

const NOTES = "C C# D D# E F F# G G# A A# B".split(" ");
const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

/** the tuner names keys with sharps ("D# major"); shift a fixture key by some semitones */
function tunerKey(key: string, shift = 0): string {
  const [rawNote, mode = "major"] = key.trim().split(/\s+/);
  const note = FLATS[rawNote] ?? rawNote;
  const r = NOTES.indexOf(note);
  if (r < 0) return key;
  return `${NOTES[(r + shift + 12) % 12]} ${mode.toLowerCase()}`;
}

/** four takes: the fixture's two scored takes at 1 and 3, tuner rejects at 2 and 4 */
function fourTakes(base: Tape) {
  const scored = base.takes ?? [];
  const band = tunerKey(base.key);
  const plan: { from: number | null; inKey: number; shift: number }[] = [
    { from: 0, inKey: 0.88, shift: 0 },
    { from: null, inKey: 0.66, shift: 2 },
    { from: 1, inKey: 0.92, shift: 0 },
    { from: null, inKey: 0.71, shift: 7 },
  ];
  const audioFor = (i: number) => (scored[0]?.audio ?? `/tapes/${base.id}/take-0.mp3`).replace(/take-\d+/, `take-${i}`);
  return plan.map((p, i) => {
    const t = p.from === null ? null : scored[p.from] ?? null;
    const cut = !t || p.inKey < 0.75;
    return {
      audio: t?.audio ?? audioFor(i),
      tuning: { inKey: p.inKey, vocalKey: tunerKey(base.key, p.shift), bandKey: band },
      verdict: cut
        ? {
            score: 0,
            voice: 0,
            words: 0,
            genre: 0,
            verdict: `cut by the tuner: only ${Math.round(p.inKey * 100)}% of the singing sat in the band's ${band}`,
            kept: false,
            cut: true,
          }
        : { score: t!.score, voice: t!.voice, words: t!.words, genre: t!.genre, verdict: t!.verdict, kept: t!.kept, cut: false },
    };
  });
}

export function runMock(
  photoSrcs: string[],
  name: string,
  note: string,
  onEvent: (e: SongEvent) => void,
  opts: { speed?: number; failAt?: Stage | null } = {},
): MockRun {
  const speed = opts.speed ?? 1;
  const motionRoll = photoSrcs.length === MOTION_ROLL.length && MOTION_ROLL.every((f) => photoSrcs.some((s) => s.includes(f)));
  const base: Tape = motionRoll ? MOTION_FIXTURE : FIXTURE;
  const real = motionRoll;
  const n = Math.max(1, Math.min(photoSrcs.length, base.photos.length));
  const id = `t_mock${Date.now().toString(36).slice(-5)}`;
  let cancelled = false;
  const timers: number[] = [];

  const photos = base.photos.slice(0, n).map((p, i) => ({ ...p, src: real ? p.src : photoSrcs[i] }));
  const lines = base.lines.filter((l) => l.photo === null || l.photo < n);
  const band = (base.band ?? []).filter((b) => b.photo < n);
  const takes = fourTakes(base);
  const realTakes = new URLSearchParams(location.search).get("takes");
  if (realTakes && /^t_[a-z0-9]+$/i.test(realTakes)) takes.forEach((t, i) => (t.audio = `/tapes/${realTakes}/takes/take-${i}.mp3`));
  const who = name.trim().toLowerCase() || null;
  const baseName = base.name ?? "ada";
  const swap = (t: string) => (who ? t.replace(new RegExp(`\\b${baseName}\\b`, "gi"), who) : t);
  const cutouts: (string | null)[] = photos.map((p) => (real ? p.cutout : null));

  type Step = [number, () => SongEvent | Promise<SongEvent> | null];
  const script: Step[] = [];
  const at = (delay: number, fn: Step[1]) => script.push([delay, fn]);
  const prog = (v: number) => at(0, () => ({ type: "progress", value: v }));
  const stage = (s: Stage, delay: number, p: number) => {
    if (opts.failAt === s) {
      at(delay, () => ({
        type: "error",
        message: s === "recording" ? "the session band walked out. they'll be back in a minute." : "the tape jammed. the machine lost its place.",
        stage: s,
      }));
      return true;
    }
    at(delay, () => ({ type: "stage", stage: s, label: LABELS[s] }));
    prog(p);
    return false;
  };

  (() => {
    if (stage("looking", 500, 0.03)) return;
    photos.forEach((p, i) => at(i === 0 ? 7600 : 40, () => ({ type: "seen", photo: i, hero: p.hero, seen: p.seen })));
    at(30, () => ({ type: "order", order: photos.map((_, i) => i) }));
    prog(0.12);
    if (stage("cutting", 300, 0.14)) return;
    // SAM works in parallel with the producer: the cuts land early in producing
    if (stage("producing", 300, 0.2)) return;
    let producing = 0;
    photos.forEach((p, i) => {
      const d = i === 0 ? 1600 : 1100;
      producing += d;
      at(d, async () => {
        if (!real) cutouts[i] = p.box ? await fakeCutout(p.src, p.box) : null;
        return {
          type: "cut",
          photo: i,
          cutout: cutouts[i],
          box: cutouts[i] ? p.box : null,
          motion: real ? p.motion ?? null : null,
          motionBox: real ? p.motionBox ?? null : null,
          clip: real ? p.clip ?? null : null,
        };
      });
    });
    at(22000 - producing, () => ({ type: "stage", stage: "producing", label: "the checker binned a demo. 2 notes" }));
    at(18000, () => ({ type: "genre", genre: base.genre ?? "", why: base.why ?? "", bpm: base.bpm, key: base.key }));
    at(20, () => ({ type: "title", title: swap(base.title) }));
    lines.forEach((l, i) =>
      at(10, () => ({ type: "line", index: i, text: swap(l.text), photo: l.photo, section: l.section ?? "" })),
    );
    band.forEach((b) => at(10, () => ({ type: "band", photo: b.photo, role: b.role })));
    prog(0.42);
    if (stage("recording", 300, 0.45)) return;
    takes.forEach((t, i) => {
      at(i === 0 ? 19000 : i === 1 ? 8500 : 15500, () => ({ type: "take", index: i, audio: t.audio, ...t.tuning }));
      // the painters finish while the band records, as on the server
      if (i === 0) {
        if (base.cover) at(4000, () => ({ type: "cover", src: base.cover as string }));
        at(3000, () => ({ type: "directed", shots: lines.length }));
      }
    });
    prog(0.7);
    if (stage("listening", 300, 0.72)) return;
    // every verdict lands at once, as the server sends them
    takes.forEach((t, i) => at(i === 0 ? 9500 : 0, () => ({ type: "verdict", index: i, ...t.verdict })));
    at(300, () => ({ type: "stage", stage: "listening", label: "timing every word to the singing" }));
    at(4200, () => ({ type: "timed", lines: lines.length, of: lines.length, words: lines.reduce((n, l) => n + l.words.length, 0) }));
    if (stage("pressing", 100, 0.88)) return;
    at(4500, () => ({ type: "progress", value: 1 }));
    at(400, () => {
      const tape: Tape = {
        ...base,
        id,
        createdAt: new Date().toISOString(),
        name: who ?? base.name,
        title: swap(base.title),
        artist: base.artist ? swap(base.artist) : base.artist,
        note: note.trim() || base.note || null,
        dedication: swap(base.dedication),
        liner: swap(base.liner),
        photos: photos.map((p, i) => ({ ...p, cutout: cutouts[i] })),
        takes: takes.map((t) => ({ audio: t.audio, ...t.verdict, ...t.tuning })),
        lines: lines.map((l) => ({ ...l, text: swap(l.text), words: l.words.map((w) => ({ ...w, text: swap(w.text) })) })),
        credits:
          note.trim() && !base.credits.some((c) => c.role === "heard your note")
            ? [...base.credits, { role: "heard your note", model: "Muse Voice Transcribe" }]
            : base.credits,
      };
      return { type: "done", tape };
    });
  })();

  let i = 0;
  const next = () => {
    if (cancelled || i >= script.length) return;
    const [delay, fn] = script[i++];
    timers.push(
      window.setTimeout(async () => {
        if (cancelled) return;
        const ev = await fn();
        if (cancelled) return;
        if (ev) onEvent(ev);
        if (ev?.type === "error" || ev?.type === "done") return;
        next();
      }, delay / speed),
    );
  };
  next();

  return {
    cancel: () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    },
    songSrcs: photos.map((p) => p.src),
  };
}
