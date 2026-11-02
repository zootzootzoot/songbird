import { useCallback, useEffect, useReducer, useRef } from "react";
import { createTape, getTape, openEvents, remember, HttpError } from "./api";
import { asset, BASE, media } from "./env";
import { sound } from "./audio";
import { downscale, urlToBlob } from "./image";
import { mockSpeed, runMock } from "./mock";
import type { Box, SongEvent, Stage, Tape } from "./types";

/**
 * The deck's state machine, driven by the server's events.
 *
 * empty -> loaded -> sending -> working -> done
 *                          \-> error (retry, or a tape from the shelf)
 *
 * Event handlers are idempotent (keyed by index) because the server replays
 * the whole stream on reconnect.
 */

export type Phase = "empty" | "loaded" | "sending" | "working" | "done" | "error";

export type LocalPhoto = { key: string; src: string; blob?: Blob; sample?: boolean; video?: boolean; filename?: string };

export type LogEntry =
  | { key: string; kind: "stage"; stage: Stage; label: string }
  | { key: string; kind: "seen"; photo: number; hero: string; seen: string }
  | { key: string; kind: "cut"; photo: number; hero: string; ok: boolean; moving: boolean }
  | { key: string; kind: "title"; title: string }
  | { key: string; kind: "genre"; genre: string; why: string; bpm: number; musicKey: string }
  | { key: string; kind: "line"; index: number; text: string; photo: number | null; section: string }
  | { key: string; kind: "band"; photo: number; role: string; hero: string }
  | { key: string; kind: "take"; index: number }
  | { key: string; kind: "verdict"; index: number };

export type TakeState = {
  audio?: string;
  score?: number;
  voice?: number;
  words?: number;
  genre?: number;
  verdict?: string;
  kept?: boolean;
  cut?: boolean;
  inKey?: number | null;
  vocalKey?: string | null;
  bandKey?: string;
};

export type Work = {
  id: string | null;
  stage: Stage | null;
  label: string;
  seen: Record<number, { hero: string; seen: string }>;
  cuts: Record<number, { cutout: string | null; box: Box | null; motion?: string | null; motionBox?: Box | null; clip?: string | null }>;
  order: number[] | null;
  title: string | null;
  genre: { genre: string; why: string; bpm: number; key: string } | null;
  band: Record<number, string>;
  takes: Record<number, TakeState>;
  lines: Record<number, { text: string; photo: number | null; section: string }>;
  sung: Record<number, true>;
  progress: number;
  log: LogEntry[];
};

/**
 * Index space: the server (pipeline.py) emits every `photo` index in song order,
 * saves the photos as /tapes/<id>/photo-<k>.jpg in that order, and sends an
 * identity `order`. So on the first `seen` the strip re-clips its prints in
 * song order, and from then on every index lines up with Tape.photos.
 * If `order` ever stops being identity, line photos are mapped through it.
 */
export const LINE_PHOTO_IS_SONG_ORDER = true;

/** seconds between printed lines when the server sends them in one burst */
export const LINE_STAGGER = 0.42;

export type Source = "live" | "mock" | "shelf" | "link";

export type DeckState = {
  phase: Phase;
  photos: LocalPhoto[];
  name: string;
  note: string;
  /** the note came from the mic (Muse Voice Transcribe) */
  noteSpoken: boolean;
  /** the photos as the parent loaded them, kept for a retry */
  uploaded: LocalPhoto[];
  /** where the song-ordered prints will be once the machine has looked */
  songSrcs: string[] | null;
  reordered: boolean;
  work: Work;
  tape: Tape | null;
  error: { message: string; stage?: Stage } | null;
  source: Source | null;
  /** bumps every time a fresh tape is loaded, so the j-card can re-animate */
  reel: number;
  /** a short printed note from the tray, e.g. a clip that was too big */
  notice: string | null;
};

const emptyWork = (): Work => ({
  id: null,
  stage: null,
  label: "",
  seen: {},
  cuts: {},
  order: null,
  title: null,
  genre: null,
  band: {},
  takes: {},
  lines: {},
  sung: {},
  progress: 0,
  log: [],
});

const initial: DeckState = {
  phase: "empty",
  photos: [],
  name: "",
  note: "",
  noteSpoken: false,
  uploaded: [],
  songSrcs: null,
  reordered: false,
  work: emptyWork(),
  tape: null,
  error: null,
  source: null,
  reel: 0,
  notice: null,
};

type Action =
  | { type: "add"; photos: LocalPhoto[]; notice?: string | null }
  | { type: "remove"; key: string }
  | { type: "clear" }
  | { type: "name"; value: string }
  | { type: "note"; value: string; spoken?: boolean }
  | { type: "sending"; source: Source; songSrcs?: string[] }
  | { type: "started"; id: string }
  | { type: "event"; event: SongEvent }
  | { type: "fail"; message: string; stage?: Stage }
  | { type: "loadTape"; tape: Tape; source: Source }
  | { type: "resume"; id: string };

const MAX = 6;
const MIN = 3;
const MAX_VIDEO = 90 * 1024 * 1024;

function pushLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  if (log.some((e) => e.key === entry.key)) return log;
  return [...log, entry];
}

function reduceEvent(state: DeckState, ev: SongEvent): DeckState {
  const w = state.work;
  switch (ev.type) {
    case "stage":
      return {
        ...state,
        phase: state.phase === "sending" ? "working" : state.phase,
        work: {
          ...w,
          stage: ev.stage,
          label: ev.label,
          // the same stage can report twice ("writing", then "checking the words fit")
          log: pushLog(w.log, { key: `stage-${ev.stage}-${ev.label}`, kind: "stage", stage: ev.stage, label: ev.label }),
        },
      };
    case "seen": {
      let photos = state.photos;
      let reordered = state.reordered;
      if (state.source === "link" && w.id) {
        photos = ensureResumePhotos(photos, w.id, ev.photo);
      } else if (!reordered && state.songSrcs) {
        // the machine has put the day in order: re-clip the prints that way
        photos = state.songSrcs.map((src, k) => ({ key: `song-${w.id ?? "x"}-${k}`, src }));
        reordered = true;
      }
      return {
        ...state,
        phase: state.phase === "sending" ? "working" : state.phase,
        photos,
        reordered,
        work: {
          ...w,
          seen: { ...w.seen, [ev.photo]: { hero: ev.hero, seen: ev.seen } },
          log: pushLog(w.log, { key: `seen-${ev.photo}`, kind: "seen", photo: ev.photo, hero: ev.hero, seen: ev.seen }),
        },
      };
    }
    case "cut":
      return {
        ...state,
        work: {
          ...w,
          cuts: {
            ...w.cuts,
            [ev.photo]: { cutout: ev.cutout, box: ev.box, motion: ev.motion ?? null, motionBox: ev.motionBox ?? null, clip: ev.clip ?? null },
          },
          log: pushLog(w.log, {
            key: `cut-${ev.photo}`,
            kind: "cut",
            photo: ev.photo,
            hero: w.seen[ev.photo]?.hero ?? `picture ${ev.photo + 1}`,
            ok: Boolean(ev.cutout || ev.motion),
            moving: Boolean(ev.motion),
          }),
        },
      };
    case "order":
      return { ...state, work: { ...w, order: ev.order } };
    case "title":
      return {
        ...state,
        work: { ...w, title: ev.title, log: pushLog(w.log, { key: "title", kind: "title", title: ev.title }) },
      };
    case "line": {
      const section = ev.section ?? "";
      return {
        ...state,
        work: {
          ...w,
          lines: { ...w.lines, [ev.index]: { text: ev.text, photo: ev.photo, section } },
          log: pushLog(w.log, { key: `line-${ev.index}`, kind: "line", index: ev.index, text: ev.text, photo: ev.photo, section }),
        },
      };
    }
    case "genre":
      return {
        ...state,
        work: {
          ...w,
          genre: { genre: ev.genre, why: ev.why, bpm: ev.bpm, key: ev.key },
          log: pushLog(w.log, { key: "genre", kind: "genre", genre: ev.genre, why: ev.why, bpm: ev.bpm, musicKey: ev.key }),
        },
      };
    case "band":
      return {
        ...state,
        work: {
          ...w,
          band: { ...w.band, [ev.photo]: ev.role },
          log: pushLog(w.log, {
            key: `band-${ev.photo}`,
            kind: "band",
            photo: ev.photo,
            role: ev.role,
            hero: w.seen[ev.photo]?.hero ?? `picture ${ev.photo + 1}`,
          }),
        },
      };
    case "take":
      return {
        ...state,
        work: {
          ...w,
          takes: {
            ...w.takes,
            [ev.index]: { ...w.takes[ev.index], audio: ev.audio, inKey: ev.inKey, vocalKey: ev.vocalKey, bandKey: ev.bandKey },
          },
          log: pushLog(w.log, { key: `take-${ev.index}`, kind: "take", index: ev.index }),
        },
      };
    case "verdict":
      return {
        ...state,
        work: {
          ...w,
          takes: {
            ...w.takes,
            [ev.index]: {
              ...w.takes[ev.index],
              score: ev.score,
              voice: ev.voice,
              words: ev.words,
              genre: ev.genre,
              verdict: ev.verdict,
              kept: ev.kept,
              cut: ev.cut,
            },
          },
          log: pushLog(w.log, { key: `verdict-${ev.index}`, kind: "verdict", index: ev.index }),
        },
      };
    case "sung":
      return { ...state, work: { ...w, sung: { ...w.sung, [ev.index]: true } } };
    case "progress":
      return { ...state, work: { ...w, progress: Math.max(w.progress, Math.min(1, ev.value)) } };
    case "done":
      return {
        ...state,
        phase: "done",
        tape: ev.tape,
        work: { ...w, progress: 1 },
        reel: state.reel + 1,
      };
    case "error":
      return { ...state, phase: "error", error: { message: ev.message, stage: ev.stage } };
  }
}

function ensureResumePhotos(photos: LocalPhoto[], id: string, upTo: number): LocalPhoto[] {
  if (photos[upTo]) return photos;
  const next = [...photos];
  for (let i = 0; i <= upTo && i < MAX; i += 1) {
    if (!next[i]) next[i] = { key: `${id}-${i}`, src: media(`/tapes/${id}/photo-${i}.jpg`)! };
  }
  return next;
}

function reducer(state: DeckState, action: Action): DeckState {
  switch (action.type) {
    case "add": {
      if (state.phase === "sending" || state.phase === "working") return state;
      // loading photos after a finished tape starts a fresh deck
      const base =
        state.phase === "done"
          ? []
          : state.phase === "error" && state.uploaded.length
            ? state.uploaded
            : state.photos;
      const seen = new Set(base.map((p) => p.key));
      const next = [...base];
      for (const p of action.photos) {
        if (next.length >= MAX) break;
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        next.push(p);
      }
      return {
        ...state,
        photos: next,
        uploaded: [],
        notice: action.notice ?? null,
        phase: next.length ? "loaded" : "empty",
        tape: null,
        work: emptyWork(),
        error: null,
        source: null,
      };
    }
    case "remove": {
      if (state.phase !== "loaded" && state.phase !== "empty" && state.phase !== "error") return state;
      const base = state.phase === "error" && state.uploaded.length ? state.uploaded : state.photos;
      const next = base.filter((p) => p.key !== action.key);
      return { ...state, photos: next, uploaded: [], phase: next.length ? "loaded" : "empty", error: null, work: emptyWork() };
    }
    case "clear":
      return { ...initial, name: state.name, note: state.note, noteSpoken: state.noteSpoken, reel: state.reel };
    case "name":
      return { ...state, name: action.value.slice(0, 18) };
    case "note": {
      const note = action.value.slice(0, 200);
      const noteSpoken = action.spoken === undefined ? state.noteSpoken && note.trim().length > 0 : action.spoken;
      return { ...state, note, noteSpoken };
    }
    case "sending": {
      const uploaded = state.phase === "error" && state.uploaded.length ? state.uploaded : state.photos;
      return {
        ...state,
        phase: "sending",
        photos: uploaded,
        uploaded,
        songSrcs: action.songSrcs ?? null,
        reordered: false,
        work: emptyWork(),
        error: null,
        tape: null,
        source: action.source,
      };
    }
    case "started":
      return {
        ...state,
        songSrcs: state.photos.map((_, k) => media(`/tapes/${action.id}/photo-${k}.jpg`)!),
        work: { ...state.work, id: action.id },
      };
    case "event":
      return reduceEvent(state, action.event);
    case "fail":
      return { ...state, phase: "error", error: { message: action.message, stage: action.stage } };
    case "loadTape":
      return {
        ...state,
        phase: "done",
        tape: action.tape,
        photos: action.tape.photos.map((p, i) => ({ key: `${action.tape.id}-${i}`, src: p.src })),
        uploaded: [],
        songSrcs: null,
        work: { ...emptyWork(), id: action.tape.id, progress: 1 },
        error: null,
        source: action.source,
        name: action.tape.name ?? "",
        reel: state.reel + 1,
      };
    case "resume":
      return {
        ...state,
        phase: "working",
        photos: [],
        work: { ...emptyWork(), id: action.id },
        source: "link",
        tape: null,
        error: null,
      };
  }
}

/** the link to send: this site + ?tape=<id> (on the FastAPI server, /t/<id> also works) */
export function tapeUrl(id: string): string {
  return `${location.origin}${BASE}?tape=${encodeURIComponent(id)}`;
}

export function setUrlTape(id: string | null) {
  try {
    const url = new URL(location.href);
    url.searchParams.delete("print");
    if (id) url.searchParams.set("tape", id);
    else url.searchParams.delete("tape");
    url.pathname = BASE;
    history.replaceState(null, "", url.toString());
  } catch {
    /* ignore */
  }
}

const isMock = () => import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

export function useDeck() {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const closeRef = useRef<(() => void) | null>(null);
  const urls = useRef<string[]>([]);
  const burst = useRef({ at: 0, n: 0 });

  useEffect(
    () => () => {
      closeRef.current?.();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const onEvent = useCallback((event: SongEvent) => {
    const before = stateRef.current;
    dispatch({ type: "event", event });
    // foley, keyed to the physical thing that happened
    switch (event.type) {
      case "seen":
        if (!before.work.seen[event.photo]) sound.click();
        if (!before.reordered && before.songSrcs) [0, 1, 2, 3, 4, 5].forEach((i) => sound.paper(0.15 + i * 0.08));
        break;
      case "cut":
        if (!before.work.cuts[event.photo] && event.cutout) sound.peel();
        break;
      case "title":
        sound.print();
        break;
      case "genre":
        sound.thunk();
        window.setTimeout(() => sound.bell(), 260);
        break;
      case "band":
        if (!before.work.band[event.photo]) sound.click();
        break;
      case "take":
        if (!before.work.takes[event.index]?.audio) sound.key(140);
        break;
      case "verdict":
        sound.thunk();
        break;
      case "line": {
        // lines arrive all at once; the printer still steps them out one by one
        const now = performance.now();
        if (now - burst.current.at > 400) burst.current.n = 0;
        burst.current.at = now;
        sound.print(Math.min(burst.current.n, 12) * LINE_STAGGER);
        burst.current.n += 1;
        break;
      }
      case "done":
        sound.stopMotor();
        sound.bell();
        remember(event.tape);
        if (!event.tape.id.startsWith("t_mock")) setUrlTape(event.tape.id);
        break;
      case "error":
        sound.stopMotor();
        break;
    }
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const all = Array.from(files);
    const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
    const usable = all.filter(
      (f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name) || isVideo(f),
    );
    const tooBig = usable.filter((f) => isVideo(f) && f.size > MAX_VIDEO);
    const list = usable.filter((f) => !(isVideo(f) && f.size > MAX_VIDEO));
    const notice = tooBig.length
      ? `${tooBig.length === 1 ? "that clip is" : "those clips are"} over 90 mb. a shorter one will do; it only keeps 3 seconds.`
      : null;
    if (!list.length) {
      if (notice) dispatch({ type: "add", photos: [], notice });
      return;
    }
    sound.ensure();
    const s = stateRef.current;
    const have = s.phase === "done" ? 0 : s.phase === "error" && s.uploaded.length ? s.uploaded.length : s.photos.length;
    const photos: LocalPhoto[] = list.slice(0, Math.max(0, MAX - have)).map((file) => {
      const src = URL.createObjectURL(file);
      urls.current.push(src);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}`,
        src,
        blob: file,
        video: isVideo(file),
        filename: file.name,
      };
    });
    photos.forEach((_, i) => sound.paper(i * 0.09));
    dispatch({ type: "add", photos, notice });
  }, []);

  const addSample = useCallback(() => {
    sound.ensure();
    // the sample roll: three pictures and a clip from the bath
    const files = ["photo-01.jpg", "photo-05.jpg", "photo-02.jpg", "bath.mp4"];
    const photos: LocalPhoto[] = files.map((f, i) => ({
      key: `sample-${i}`,
      src: asset(`samples/sunday/${f}`),
      sample: true,
      video: f.endsWith(".mp4"),
      filename: f,
    }));
    photos.forEach((_, i) => sound.paper(i * 0.09));
    if (stateRef.current.phase === "done") dispatch({ type: "add", photos: [] });
    dispatch({ type: "add", photos });
  }, []);

  const remove = useCallback((key: string) => {
    sound.click();
    dispatch({ type: "remove", key });
  }, []);

  const setName = useCallback((value: string) => dispatch({ type: "name", value }), []);
  const setNote = useCallback((value: string, spoken?: boolean) => dispatch({ type: "note", value, spoken }), []);

  const pull = useCallback(async () => {
    const s = stateRef.current;
    const source = s.phase === "error" && s.uploaded.length ? s.uploaded : s.photos;
    if (source.length < MIN || s.phase === "sending" || s.phase === "working") return;
    sound.ensure();
    sound.thunk();
    window.setTimeout(() => sound.startMotor(), 250);
    closeRef.current?.();

    if (isMock()) {
      const params = new URLSearchParams(location.search);
      const failAt = (params.get("fail") as Stage | null) ?? null;
      const run = runMock(
        source.map((p) => p.src),
        s.name,
        s.note,
        onEvent,
        { speed: mockSpeed(), failAt },
      );
      dispatch({ type: "sending", source: "mock", songSrcs: run.songSrcs });
      closeRef.current = run.cancel;
      return;
    }

    dispatch({ type: "sending", source: "live" });
    try {
      const blobs = await Promise.all(
        source.map(async (p, i) => {
          const raw = p.blob ?? (await urlToBlob(p.src));
          if (p.video) return { blob: raw, name: p.filename ?? `clip-${i}.mp4` };
          return { blob: await downscale(raw), name: `photo-${i}.jpg` };
        }),
      );
      const { id } = await createTape(blobs, s.name, s.note, s.noteSpoken);
      dispatch({ type: "started", id });
      closeRef.current = openEvents(id, onEvent, () => {
        if (stateRef.current.phase === "working" || stateRef.current.phase === "sending") {
          sound.stopMotor();
          dispatch({ type: "fail", message: "lost the line to the machine room. it may still be working." });
        }
      });
    } catch (err) {
      sound.stopMotor();
      const message =
        err instanceof HttpError ? err.message : "something in the deck jammed before the tape could start.";
      dispatch({ type: "fail", message });
    }
  }, [onEvent]);

  const loadTape = useCallback((tape: Tape, source: Source) => {
    closeRef.current?.();
    remember(tape);
    dispatch({ type: "loadTape", tape, source });
    if (source !== "link") setUrlTape(tape.id);
  }, []);

  /** `?tape=<id>`: a finished tape, or one still being made (attach to its events) */
  const openById = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const tape = await getTape(id);
        if (tape) {
          loadTape(tape, "link");
          return true;
        }
        dispatch({ type: "resume", id });
        closeRef.current?.();
        closeRef.current = openEvents(id, onEvent, () =>
          dispatch({ type: "fail", message: "couldn't find that tape in the machine room." }),
        );
        return true;
      } catch {
        dispatch({ type: "fail", message: "couldn't find that tape. the studio is closed and it isn't on the shelf." });
        return false;
      }
    },
    [loadTape, onEvent],
  );

  const eject = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    sound.stopMotor();
    dispatch({ type: "clear" });
    setUrlTape(null);
  }, []);

  return { state, addFiles, addSample, remove, setName, setNote, pull, loadTape, openById, eject, MIN, MAX };
}

export type Deck = ReturnType<typeof useDeck>;
