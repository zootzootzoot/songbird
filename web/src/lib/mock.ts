/**
 * Dev-only `?mock=1`: replays an event stream shaped like a real run of the
 * label pipeline, so working -> done -> play can be exercised without the
 * server. Gated on import.meta.env.DEV by the caller.
 *
 * The sample roll (three pictures and a bath clip) replays SB-0006, which has a
 * moving SAM sticker. Your own photos replay SB-0007's words over your
 * pictures with fake oval stickers.
 *
 * Shape: ~8 s looking (every `seen` at once), ~4 s of cuts, ~55 s producing
 * (genre, title, lines, band arrive at the end), ~30 s recording (two takes),
 * ~15 s listening (two verdicts), ~15 s pressing, done.
 *
 * URL options: `speed=3` (faster), `fail=<stage>`.
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
  const takes = base.takes ?? [];
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
    photos.forEach((p, i) =>
      at(i === 0 ? 700 : 650, async () => {
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
      }),
    );
    prog(0.2);
    if (stage("producing", 400, 0.22)) return;
    prog(0.3);
    at(44000, () => ({ type: "genre", genre: base.genre ?? "", why: base.why ?? "", bpm: base.bpm, key: base.key }));
    prog(0.4);
    at(3600, () => ({ type: "title", title: swap(base.title) }));
    lines.forEach((l, i) =>
      at(i === 0 ? 1400 : 25, () => ({ type: "line", index: i, text: swap(l.text), photo: l.photo, section: l.section ?? "" })),
    );
    band.forEach((b, i) => at(i === 0 ? 4200 : 500, () => ({ type: "band", photo: b.photo, role: b.role })));
    prog(0.48);
    if (stage("recording", 900, 0.5)) return;
    takes.forEach((t, i) => {
      at(i === 0 ? 15000 : 14000, () => ({ type: "take", index: i, audio: t.audio }));
      prog(0.5 + 0.15 * (i + 1));
    });
    if (stage("listening", 600, 0.82)) return;
    takes.forEach((t, i) =>
      at(i === 0 ? 6500 : 5500, () => ({
        type: "verdict",
        index: i,
        score: t.score,
        voice: t.voice,
        words: t.words,
        genre: t.genre,
        verdict: t.verdict,
        kept: t.kept,
      })),
    );
    if (stage("pressing", 1800, 0.9)) return;
    at(9000, () => ({ type: "progress", value: 1 }));
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
