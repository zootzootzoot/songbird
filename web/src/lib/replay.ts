/**
 * "Watch it get made": the control room replays a finished release's real session from what the release kept
 * (its photos, SAM's cutouts, the producer's genre and sheet, Muse Image's band, the four takes with their tuner
 * readings and A&R verdicts, the sleeve). Every event is the one the GPU server sent when it was made, in the
 * order it sent them; `session` (the server's own stage marks, in seconds) places them in time. The room's clocks
 * run on session time, so they read what the real session took while the replay plays `speed`x faster.
 */
import type { SongEvent, Stage, Tape } from "./types";

/** stage marks, seconds from the click: when looking, producing, recording and listening finished */
export type Session = { look: number; produce: number; record: number; listen: number };

/** a typical session on the studio's GPU, for releases made before the marks were kept */
const TYPICAL: Session = { look: 15, produce: 43, record: 195, listen: 213 };

export const REPLAY_SPEED = 3;

const abs = (u: string | null | undefined): string | null => (u ? new URL(u, location.href).href : null);

export function sessionOf(tape: Tape): Session {
  const s = (tape as Tape & { session?: Partial<Session> }).session;
  const ok = s && [s.look, s.produce, s.record, s.listen].every((v) => typeof v === "number" && v > 0);
  return ok ? (s as Session) : TYPICAL;
}

export type Replay = { cancel: () => void; photos: string[] };

export function runReplay(tape: Tape, onEvent: (e: SongEvent) => void, speed = REPLAY_SPEED): Replay {
  const S = sessionOf(tape);
  const ev: [number, SongEvent][] = [];
  const at = (sec: number, e: SongEvent) => ev.push([sec * 1000, e]);
  const stage = (sec: number, stage: Stage, label: string, progress: number) => {
    at(sec, { type: "stage", stage, label });
    at(sec, { type: "progress", value: progress });
  };
  const photos = tape.photos;
  const lines = tape.lines;
  const takes = tape.takes ?? [];

  // looking: Spark sees the whole day, then puts it in order
  stage(0.6, "looking", "looking at today", 0.04);
  photos.forEach((p, i) => at(S.look - 1.2 + i * 0.12, { type: "seen", photo: i, hero: p.hero, seen: p.seen }));
  at(S.look - 0.4, { type: "order", order: photos.map((_, i) => i) });
  at(S.look - 0.4, { type: "progress", value: 0.1 });
  // casting: SAM cuts while the producer starts writing
  stage(S.look, "cutting", "casting the band", 0.12);
  stage(S.look + 0.3, "producing", "the producer is thinking", 0.2);
  photos.forEach((p, i) =>
    at(S.look + 2 + i * 1.3, {
      type: "cut",
      photo: i,
      cutout: abs(p.cutout),
      box: p.cutout ? p.box : null,
      motion: abs(p.motion),
      motionBox: p.motion ? p.motionBox ?? null : null,
      clip: abs(p.clip),
    }),
  );
  // the sheet lands in one burst, as the producer hands it over
  const pr = S.produce - 0.6;
  at(pr, { type: "genre", genre: tape.genre ?? "", why: tape.why ?? "", bpm: tape.bpm, key: tape.key });
  at(pr + 0.02, { type: "title", title: tape.title });
  lines.forEach((l, i) =>
    at(pr + 0.04 + i * 0.01, { type: "line", index: i, text: l.text, photo: l.photo, section: l.section ?? "" }),
  );
  (tape.band ?? []).forEach((b, i) => at(pr + 0.3 + i * 0.01, { type: "band", photo: b.photo, role: b.role }));
  at(S.produce - 0.1, { type: "progress", value: 0.42 });

  // recording: four takes one at a time; Muse Image paints and dresses, Spark directs, meanwhile
  stage(S.produce, "recording", "rolling tape", 0.45);
  const rec = S.record - S.produce;
  takes.forEach((t, i) =>
    at(S.produce + rec * ((i + 1) / takes.length) - 0.3, {
      type: "take",
      index: i,
      audio: abs(t.audio) ?? t.audio,
      inKey: t.inKey ?? null,
      vocalKey: t.vocalKey ?? null,
      bandKey: t.bandKey,
    }),
  );
  if (tape.cover) at(S.produce + rec * 0.36, { type: "cover", src: abs(tape.cover)! });
  if (tape.direction) at(S.produce + rec * 0.3, { type: "directed", shots: tape.direction.shots.length });
  photos.forEach((p, i) => {
    if (p.performer) at(S.produce + rec * (0.42 + i * 0.07), { type: "performer", photo: i, src: abs(p.performer)! });
  });
  at(S.record - 0.1, { type: "progress", value: 0.7 });

  // listening: the tuner's cuts and Spark 1.2's verdicts arrive together
  stage(S.record, "listening", "the producer is listening back", 0.72);
  const heard = S.listen - S.record;
  takes.forEach((t, i) =>
    at(S.record + heard * 0.62, {
      type: "verdict",
      index: i,
      score: t.score,
      voice: t.voice,
      words: t.words,
      genre: t.genre,
      verdict: t.verdict,
      kept: t.kept,
      cut: t.cut,
      sung: t.sung ?? null,
    }),
  );
  at(S.record + heard * 0.66, { type: "stage", stage: "listening", label: "timing every word to the singing" });
  const timed = lines.filter((l) => l.words?.length);
  at(S.listen - 0.2, { type: "timed", lines: timed.length, of: lines.length, words: timed.reduce((n, l) => n + l.words.length, 0) });
  stage(S.listen, "pressing", "pressing the record", 0.88);
  at(S.listen + 1.8, { type: "progress", value: 1 });
  at(S.listen + 2.2, { type: "done", tape });

  ev.sort((a, b) => a[0] - b[0]);
  const t0 = performance.now();
  let i = 0;
  let timer = 0;
  let cancelled = false;
  const pump = () => {
    if (cancelled) return;
    const t = (performance.now() - t0) * speed;
    while (i < ev.length && ev[i][0] <= t) onEvent(ev[i++][1]);
    if (i < ev.length) timer = window.setTimeout(pump, Math.max(0, (ev[i][0] - t) / speed));
  };
  pump();
  return {
    cancel: () => {
      cancelled = true;
      window.clearTimeout(timer);
    },
    photos: photos.map((p) => abs(p.src) ?? p.src),
  };
}
