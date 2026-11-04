/** Mirrors docs/CONTRACT.md. Keep in sync with the server. */

export type Stage = "looking" | "cutting" | "producing" | "recording" | "listening" | "pressing";

export const STAGES: Stage[] = ["looking", "cutting", "producing", "recording", "listening", "pressing"];

export type Box = [number, number, number, number];

export type Photo = {
  src: string;
  cutout: string | null;
  box: Box | null;
  hero: string;
  seen: string;
  /** videos only: animated WebP sticker, SAM 3.1 following the hero through the clip */
  motion?: string | null;
  motionBox?: Box | null;
  /** videos only: the 3 s muted clip */
  clip?: string | null;
  /** the hero redrawn by Muse Image as its band role in the genre's wardrobe, keyed out (RGBA) */
  performer?: string | null;
};

export type Word = { text: string; start: number; end: number };

export type Line = {
  text: string;
  section?: string;
  kind: "verse" | "chorus" | "other" | "refrain";
  photo: number | null;
  start: number;
  end: number;
  words: Word[];
  /** aligned: every word placed on the vocal by the MMS forced aligner; heard: Voice Transcribe phrase times */
  timing?: "aligned" | "heard";
};

export type Credit = { role: string; model: string };

export type Take = {
  audio: string;
  score: number;
  voice: number;
  words: number;
  genre: number;
  verdict: string;
  kept: boolean;
  /** cut by the tuner before the producer heard it */
  cut?: boolean;
  /** share of the sheet's lines actually sung (Demucs vocal + Voice Transcribe), when measured */
  sung?: number | null;
  /** share of sung time on the band's scale (Demucs split + pitch track) */
  inKey?: number | null;
  vocalKey?: string | null;
  bandKey?: string;
};

export type Tape = {
  id: string;
  catalog?: string;
  createdAt: string;
  title: string;
  artist?: string;
  name: string | null;
  dedication: string;
  genre?: string;
  /** the repertoire style the band played it in (picks the video theme); older tapes lack it */
  style?: string;
  why?: string;
  caption?: string;
  liner: string;
  note?: string | null;
  bpm: number;
  meter?: number;
  key: string;
  duration: number;
  audio: string;
  takes?: Take[];
  cover: string | null;
  palette: string[];
  photos: Photo[];
  band?: { photo: number; role: string }[];
  lines: Line[];
  credits: Credit[];
  /** the video's shot list, written by Muse Spark 1.3; older tapes lack it */
  direction?: Direction;
};

export type ShotKind = "close-up" | "two-shot" | "wide" | "solo" | "lineup" | "photo" | "low-angle";
export type CameraMove = "static" | "push-in" | "pull-out" | "pan-left" | "pan-right" | "orbit" | "handheld" | "snap-zoom" | "crane-up";
export type ShotFx = "none" | "strobe" | "freeze" | "echo" | "split" | "spotlight" | "flash";
export type Shot = { shot: ShotKind; subjects: number[]; move: CameraMove; fx: ShotFx };
export type Direction = {
  concept: string;
  intro: Shot;
  outro: Shot;
  /** one per tape.lines[i], same index */
  shots: Shot[];
  members: number;
};

/** The shelf (back catalogue). Only `id` is guaranteed. */
export type TapeSummary = {
  id: string;
  catalog?: string;
  title?: string;
  artist?: string;
  genre?: string;
  style?: string;
  name?: string | null;
  dedication?: string;
  createdAt?: string;
  duration?: number;
  palette?: string[];
  cover?: string | null;
  photos?: { src: string; cutout?: string | null; hero?: string }[];
};

export type SongEvent =
  | { type: "stage"; stage: Stage; label: string }
  | { type: "seen"; photo: number; hero: string; seen: string }
  | { type: "order"; order: number[] }
  | {
      type: "cut";
      photo: number;
      cutout: string | null;
      box: Box | null;
      motion?: string | null;
      motionBox?: Box | null;
      clip?: string | null;
    }
  | { type: "genre"; genre: string; why: string; bpm: number; key: string }
  | { type: "title"; title: string }
  | { type: "line"; index: number; text: string; photo: number | null; section?: string }
  | { type: "band"; photo: number; role: string }
  | { type: "performer"; photo: number; src: string }
  | { type: "take"; index: number; audio: string; inKey?: number | null; vocalKey?: string | null; bandKey?: string }
  | { type: "verdict"; index: number; score: number; voice: number; words: number; genre: number; verdict: string; kept: boolean; cut?: boolean; sung?: number | null }
  | { type: "sung"; index: number }
  /** Muse Image finished the sleeve (it paints while the band records) */
  | { type: "cover"; src: string }
  /** Muse Spark 1.3 finished the video's shot list */
  | { type: "directed"; shots: number }
  /** the MMS aligner placed the kept take's words: `lines` of `of` aligned */
  | { type: "timed"; lines: number; of: number; words: number }
  | { type: "progress"; value: number }
  | { type: "done"; tape: Tape }
  | { type: "error"; message: string; stage?: Stage };

export const EVENT_TYPES: SongEvent["type"][] = [
  "stage",
  "seen",
  "cut",
  "order",
  "genre",
  "title",
  "line",
  "band",
  "performer",
  "take",
  "verdict",
  "sung",
  "cover",
  "directed",
  "timed",
  "progress",
  "done",
  "error",
];
