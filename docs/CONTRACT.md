# Songbird contract (web <-> server)

**Songbird is a music journal: every day you live becomes a single** (see PRODUCT.md). You give it today's photos or
short clips. The producer calls the genre, casts the day's objects as the band, writes the single, records four takes,
tunes them, listens back and keeps one, presses a sleeve, and directs the video.

```
photos/clips ──► Muse Spark 1.3   looks: each item's hero (a noun phrase), what happened, details; orders the day
             ──► SAM 3.1          cuts each hero out → sticker (clips: tracks it → a moving sticker)
             ──► Muse Wonder 1.0  produces: genre + why, session notes, lyrics (every verse line belongs to a photo),
                                  the band credits, liner notes; a checker sends it back until it holds up
             ──► Muse Image 1.0   casts: redraws each cut-out as its band role in the genre's wardrobe (+ SAM mask)
             ──► Muse Spark 1.3   directs: the video's shot list, one shot per lyric line (runs while the band records)
             ──► ACE-Step 1.5 XL  the session band (open weights, on our GPU): records 4 takes
             ──► Demucs (Meta)    tuner: splits singer from band, cuts takes with < 75% of the singing in the band's key
             ──► Voice Transcribe lyric check: hears the isolated vocal phrase by phrase, aligns each line to where it
                                  was sung, drops lines the singer skipped
             ──► MMS aligner      times every sung word on the kept take's vocal (Meta, open weights, our GPU)
             ──► Muse Spark 1.2   A&R: listens to every take that passed (audio in), scores voice / words / genre, keeps one
             ──► Muse Image 1.0   the sleeve, made the way that genre's sleeves looked, from the day's cut-outs
Muse Voice Transcribe also writes down a spoken note about the day, which goes into the song.
```

Server: FastAPI on `http://127.0.0.1:8787`. The web app talks to it only through `/api/*` and `/tapes/*`
(Vite dev server proxies both; in production the API base comes from `live.json`). All URLs inside a Tape are
root-relative (`/tapes/<id>/...`).

## Endpoints

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/tapes` | `multipart/form-data`: `photos` (3–6 files: images or short video clips, in the order loaded), optional `name` (whose day it was, e.g. `maya`), optional `note` + `note_spoken` → `{ "id": "t_ab12cd34" }` |
| `POST` | `/api/transcribe` | `multipart/form-data`: `audio` (browser recording, ≤ 60 s) → `{ "text": "..." }` via Muse Voice Transcribe |
| `GET` | `/api/tapes/{id}/events` | Server-Sent Events (below). Replays everything so far on connect. Ends after `done` or `error`. |
| `GET` | `/api/tapes/{id}` | `Tape` JSON (404 until done) |
| `GET` | `/api/tapes/{id}/share` | the shareable MP4's state: `{ state: "none"\|"queued"\|"filming"\|"encoding"\|"ready"\|"error", progress, url? }` |
| `POST` | `/api/tapes/{id}/share` | start cutting it (a live release starts on its own when it's done) |
| `GET` | `/api/tapes/{id}/share.mp4` | the MP4 as a download: 1080x1920, 30 fps H.264 + AAC, the video from the cold open with the song |
| `GET` | `/api/samples` | `{ "tapes": TapeSummary[] }` the label's back catalogue (the shelf) |
| `GET` | `/api/health` | `{ ok, meta, band, busy }` |

## SSE events

```ts
type Stage = "looking" | "cutting" | "producing" | "recording" | "listening" | "pressing";

{ type: "stage",    stage: Stage, label: string }                 // short lowercase machine line
{ type: "seen",     photo: number, hero: string, seen: string }   // photo = song position (order already applied)
{ type: "order",    order: number[] }
{ type: "cut",      photo: number, cutout: string|null, box: Box|null, motion: string|null, motionBox: Box|null, clip: string|null }
{ type: "genre",    genre: string, why: string, bpm: number, key: string }   // the producer's call, a big moment
{ type: "title",    title: string }
{ type: "line",     index: number, text: string, photo: number|null, section: string }  // the lyric sheet
{ type: "band",     photo: number, role: string }                  // a casting credit, e.g. "lead vocals"
{ type: "performer", photo: number, src: string }                 // that photo's hero, dressed for its role (RGBA png)
{ type: "take",     index: number, audio: string, inKey?: number | null, vocalKey?: string | null, bandKey?: string }
                                                                  // a take is recorded and tuned (four per release)
{ type: "verdict",  index: number, score: number, voice: number, words: number, genre: number, verdict: string, kept: boolean,
  cut?: boolean, inKey?: number, sung?: number | null }           // cut: the tuner dropped it; the producer never heard it
                                                                  // sung: share of the sheet's lines actually sung
{ type: "cover",    src: string }                                 // Muse Image finished the sleeve (it paints while the band records)
{ type: "directed", shots: number }                               // Muse Spark 1.3 finished the video's shot list
{ type: "timed",    lines: number, of: number, words: number }    // the MMS aligner placed the kept take's words
{ type: "progress", value: number }
{ type: "done",     tape: Tape }
{ type: "error",    message: string, stage?: Stage }
```

## Tape

```ts
type Box = [number, number, number, number];   // normalized x1,y1,x2,y2

type Tape = {
  id: string;
  catalog: string;              // "SB-0007", the label's catalogue number
  createdAt: string;
  title: string;                // the single, lowercase
  artist: string;               // e.g. "maya y la orquesta catorce"
  name: string | null;
  dedication: string;           // e.g. "maya's tuesday 3 november"
  genre: string;                // "1930s tango cancion"
  style: string;                // the repertoire style the band played it in; picks the video theme
  why: string;                  // the producer's one-line justification
  caption: string;              // the session notes the band played from
  liner: string;                // producer's liner notes
  note: string | null;          // the one thing the photos can't show, typed or spoken
  bpm: number; key: string;
  duration: number;
  audio: string;                // the kept take, "/tapes/<id>/song.mp3"
  takes: { audio: string; score: number; voice: number; words: number; genre: number; verdict: string; kept: boolean;
           cut?: boolean; inKey?: number | null; vocalKey?: string | null; bandKey?: string; sung?: number | null }[];
  cover: string | null;
  palette: string[];
  photos: Photo[];              // song order
  band: { photo: number; role: string }[];
  lines: Line[];                // sung order, including repeated choruses
  credits: { role: string; model: string }[];
  direction?: Direction;        // the video's shot list (Muse Spark 1.3)
};

type Shot = { shot: "close-up"|"two-shot"|"wide"|"solo"|"lineup"|"photo"|"low-angle"; subjects: number[];
              move: "static"|"push-in"|"pull-out"|"pan-left"|"pan-right"|"orbit"|"handheld"|"snap-zoom"|"crane-up";
              fx: "none"|"strobe"|"freeze"|"echo"|"split"|"spotlight"|"flash" };
type Direction = { concept: string; intro: Shot; outro: Shot; shots: Shot[] /* one per line */; members: number };

type Photo = { src: string; cutout: string|null; box: Box|null; hero: string; seen: string;
               motion: string|null; motionBox: Box|null; clip: string|null;
               performer: string|null };   // the hero dressed as its band role (Muse Image + SAM mask)

type Line = {
  text: string;
  section: string;              // "Verse 1" | "Chorus" | ...
  kind: "verse" | "chorus" | "other";
  photo: number | null;
  start: number; end: number;   // seconds in song.mp3, aligned to the sung vocal
  timing?: "aligned" | "heard"; // aligned: every word placed by the MMS forced aligner; heard: Voice Transcribe phrases
  words: { text: string; start: number; end: number }[];
};
```
