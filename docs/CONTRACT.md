# Songbird contract (web <-> server)

**Songbird is a record label for small days.** You feed the deck today's photos or short clips. The producer
(a small wooden bird with enormous opinions) casts the day's objects as the band, decides the genre with total
conviction, writes the single, records takes with a session band, listens back and keeps the best one, then presses
the release: a cassette with a riso J-card, catalogue number, band credits and liner notes.

```
photos/clips ──► Muse Spark 1.3   looks: each item's hero (a noun phrase), what happened, details; orders the day
             ──► SAM 3.1          cuts each hero out → sticker (clips: tracks it → a moving sticker)
             ──► Muse Wonder 1.0  produces: genre + why, session notes, lyrics (every verse line belongs to a photo),
                                  the band credits, liner notes; a checker sends it back until it holds up
             ──► ACE-Step 1.5     the session band (open source, on our GPU): records 2 takes, with lyric timestamps
             ──► Muse Spark 1.2   A&R: listens to every take (audio in), scores voice / words / genre, keeps the best
             ──► Muse Image 1.0   the J-card cover, redrawn from the day's stickers as a riso print
Muse Voice Transcribe: a spoken note about the day ("she named the snail gary") goes into the song.
```

Server: FastAPI on `http://127.0.0.1:8787`. The web app talks to it only through `/api/*` and `/tapes/*`
(Vite dev server proxies both; in production the API base comes from `live.json`). All URLs inside a Tape are
root-relative (`/tapes/<id>/...`).

## Endpoints

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/tapes` | `multipart/form-data`: `photos` (3–6 files: images or short video clips, in the order loaded), optional `name` (whose day it was, e.g. `ada`), optional `note` + `note_spoken` → `{ "id": "t_ab12cd34" }` |
| `POST` | `/api/transcribe` | `multipart/form-data`: `audio` (browser recording, ≤ 60 s) → `{ "text": "..." }` via Muse Voice Transcribe |
| `GET` | `/api/tapes/{id}/events` | Server-Sent Events (below). Replays everything so far on connect. Ends after `done` or `error`. |
| `GET` | `/api/tapes/{id}` | `Tape` JSON (404 until done) |
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
{ type: "take",     index: number, audio: string }                 // a take is recorded (playable preview)
{ type: "verdict",  index: number, score: number, voice: number, words: number, genre: number, verdict: string, kept: boolean }
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
  artist: string;               // e.g. "ada & the small days"
  name: string | null;
  dedication: string;           // e.g. "ada's sunday 1 november"
  genre: string;                // "1973 philadelphia orchestral soul epic"
  why: string;                  // the producer's one-line justification
  caption: string;              // the session notes the band played from
  liner: string;                // producer's liner notes
  note: string | null;          // what the parent told the deck
  bpm: number; key: string;
  duration: number;
  audio: string;                // the kept take, "/tapes/<id>/song.mp3"
  takes: { audio: string; score: number; voice: number; words: number; genre: number; verdict: string; kept: boolean }[];
  cover: string | null;
  palette: string[];
  photos: Photo[];              // song order
  band: { photo: number; role: string }[];
  lines: Line[];                // sung order, including repeated choruses
  credits: { role: string; model: string }[];
};

type Photo = { src: string; cutout: string|null; box: Box|null; hero: string; seen: string;
               motion: string|null; motionBox: Box|null; clip: string|null };

type Line = {
  text: string;
  section: string;              // "Verse 1" | "Chorus" | ...
  kind: "verse" | "chorus" | "other";
  photo: number | null;
  start: number; end: number;   // seconds in song.mp3 (from the band's lyric timestamps; end may be estimated)
  words: { text: string; start: number; end: number }[];   // estimated within the line
};
```
