# Songbird contract (web <-> server)

Photos of a day go in. A sung song, cutouts and a printable J-card come out.

```
photos ──► Muse Spark 1.3 (looks: hero object, what happens, light, mood; orders the day)
       ──► SAM 3.1         (cuts each photo's hero out → transparent PNG sticker)
       ──► Muse Spark 1.3 (writes: title, one verse line per photo, refrain, per-line chord/contour plan)
       ──► composer        (syllables + stress → rhythm on the grid → melody over the chords)   [server/songbird/compose.py]
       ──► SoulX-Singer    (open-source singing voice synthesis, local GPU, sings the score)   [server/songbird/singer_worker.py]
       ──► arranger        (music box / pad / bass from the same chords, mix, master → mp3)    [server/songbird/arrange.py]
       ──► Muse Image      (J-card cover: riso illustration composed from the day's cutouts)
```

Server: FastAPI on `http://127.0.0.1:8787`. The web app talks to it only through `/api/*` and `/tapes/*`
(Vite dev server proxies both). All URLs inside a Tape are root-relative (`/tapes/<id>/...`).

## Endpoints

| Method | Path | Body / result |
|---|---|---|
| `POST` | `/api/tapes` | `multipart/form-data`: `photos` (3–6 image files, in the order the user loaded them), optional `name` (who the song is for, e.g. `maya`), optional `note` (one line about the day). → `{ "id": "t_ab12cd" }` |
| `POST` | `/api/transcribe` | `multipart/form-data`: `audio` (a browser recording, webm/ogg/mp4/wav, ≤ 60 s) → `{ "text": "she named the snail gary" }` via Muse Voice Transcribe. The deck uses it to fill the `note` before the lever is pulled. |
| `GET` | `/api/tapes/{id}/events` | Server-Sent Events, see below. Replays every event so far on connect, then streams. Ends after `done` or `error`. |
| `GET` | `/api/tapes/{id}` | `Tape` JSON (404 until done) |
| `GET` | `/api/samples` | `{ "tapes": TapeSummary[] }` finished tapes the deck can load without a GPU (demo shelf) |
| `GET` | `/api/health` | `{ "ok": true, "meta": bool, "singer": bool }` whether the Meta key and the GPU singer are available |
| `GET` | `/tapes/{id}/{file}` | static files: `photo-0.jpg`, `cut-0.png`, `song.mp3`, `cover.png`, `tape.json` |

## SSE events

Every event is `event: <type>` + `data: <json>`. Types, in the order they normally arrive:

```ts
type Stage = "looking" | "cutting" | "writing" | "composing" | "singing" | "mixing" | "printing";

{ type: "stage",   stage: Stage, label: string }                // label: short lowercase machine line, e.g. "looking at the pictures"
{ type: "seen",    photo: number, hero: string, seen: string }  // per photo, as Muse Spark finds it
{ type: "cut",     photo: number, cutout: string | null, box: [number,number,number,number] | null }  // SAM result (normalized 0..1 box)
{ type: "order",   order: number[] }                            // the order the song visits the photos
{ type: "title",   title: string }
{ type: "line",    index: number, text: string, photo: number | null }   // each lyric line as it is written
{ type: "sung",    index: number }                               // a line has been sung
{ type: "progress", value: number }                              // 0..1 overall
{ type: "done",    tape: Tape }
{ type: "error",   message: string, stage?: Stage }
```

## Tape

```ts
type Tape = {
  id: string;
  createdAt: string;            // ISO
  title: string;                // lowercase, e.g. "the snail and the sprinkler"
  name: string | null;          // who it is for
  dedication: string;           // e.g. "for maya, sunday 2 november"
  liner: string;                // 1–2 sentence liner note written by Muse Spark
  bpm: number; meter: 3 | 4; key: string;  // e.g. 92, 3, "F major"
  duration: number;             // seconds
  audio: string;                // "/tapes/<id>/song.mp3"
  cover: string | null;         // Muse Image J-card art
  palette: string[];            // 2–4 hex inks pulled from the photos
  photos: Photo[];              // in song order (photo indexes below refer to this array)
  lines: Line[];
  credits: { role: string; model: string }[];   // e.g. { role: "looked at the pictures", model: "Muse Spark 1.3" }
};

type Photo = {
  src: string;                  // "/tapes/<id>/photo-0.jpg"
  cutout: string | null;        // "/tapes/<id>/cut-0.png", transparent PNG at photo resolution, cropped to box
  box: [number, number, number, number] | null;   // normalized x1,y1,x2,y2 of the hero in the photo
  hero: string;                 // SAM noun phrase, e.g. "snail"
  seen: string;                 // what Muse Spark saw, one short clause
};

type Line = {
  text: string;
  kind: "verse" | "refrain";
  photo: number | null;         // which photo this line is about (null for refrain)
  start: number; end: number;   // seconds in song.mp3
  words: { text: string; start: number; end: number }[];
};
```

## Fixture

`web/src/fixtures/sunday.json` is a hand-written Tape over `server/samples/sunday/*.jpg` for building the UI before
the server exists. Once the server produces real tapes, the samples shelf replaces it.
