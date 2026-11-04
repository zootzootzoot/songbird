# Songbird

**A music journal. Every day you live becomes a single.**

Drop in a few photos from today. Songbird works out what kind of day it was and calls its genre, so a first day at a
new job comes out as a 1987 arcade chiptune anthem. It turns the things in your photos into the band, records the song and cuts the music
video. It takes about two minutes, and the result is yours to keep and send.

People take more than two trillion photos a year and look back at almost none of them. A camera roll keeps what a day
looked like, but a song keeps how it felt, and songs are the one memory format people never lose. Songbird turns the
most-used, least-revisited archive people own into something they will play again. See [PRODUCT.md](PRODUCT.md).

## How a day becomes a single

| step | model | what it does |
|---|---|---|
| look | Muse Spark 1.3 | reads every photo and finds what the day was about |
| cut | SAM 3.1 | cuts the things in the photos out of them |
| produce | Muse Wonder 1.0 | calls the genre, casts the band, writes the song |
| cast | Muse Image 1.0 + SAM 3.1 | dresses each thing as its band role, in the genre's wardrobe |
| record | ACE-Step 1.5 XL (open weights, local GPU) | records four takes |
| tune | Demucs (open weights, local GPU) | splits the vocal out and cuts any take under 75% in key |
| check | Muse Voice Transcribe | listens back and aligns the lyrics to what was actually sung |
| A&R | Muse Spark 1.2 (audio in) | hears the surviving takes and keeps one |
| press | Muse Image 1.0 | paints a genre-authentic sleeve |
| direct | Muse Spark 1.3 | writes the video's shot list from the lyrics, the band and the genre |

Everything a model decided is in the tape and on screen: the genre and why, the band roles, each take's tuner reading
and the A&R verdict. [docs/META_LOG.md](docs/META_LOG.md) records every problem the Meta models solved while building it.

## Three surfaces

- **The front door** (daylight): things from other people's days float in the sky, and each one opens its single.
  It also holds the shelf of releases, why songs matter, and the desk where you make your own.
- **The control room** (night): the live session. Every model is a lamp, takes arrive, and the tuner and A&R decide.
- **The video**: full-screen, with its own art direction for each genre. It performs the director's shot list with
  the cast band.

Design: [DESIGN.md](DESIGN.md). API contract: [docs/CONTRACT.md](docs/CONTRACT.md).

## Run it

```
# .env at the repo root: MODEL_API_KEY=...   (Meta Model API)
cd server && .venv\Scripts\python.exe -m uvicorn songbird.app:app --port 8787
cd web && npm install && npm run dev          # http://localhost:5173
```

The band (ACE-Step 1.5 XL + Demucs) runs as a worker process on a local CUDA GPU and warms up on server start.

## Sample days

The nine days on the shelf were photographed by Muse Image ([server/scripts/gen_days.py](server/scripts/gen_days.py)),
so no real person's photos are used. The floating objects on the front door were redrawn by Muse Image from those
photos ([server/scripts/gen_objects.py](server/scripts/gen_objects.py)). Every song, band, sleeve and video came out of
the same pipeline a visitor's day goes through.
