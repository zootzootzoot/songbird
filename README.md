# Songbird

**A music journal. Every day you live becomes a single.**

Drop in a few photos from today. Songbird works out what kind of day it was and calls its genre, so a first day at a
new job comes out as a 1989 new jack swing coronation jam. It turns the things in your photos into the band, records the song and cuts the music
video. It takes about three minutes, and the result is yours to keep and send.

People take more than two trillion photos a year and look back at almost none of them. A camera roll keeps what a day
looked like, but a song keeps how it felt, and songs are the one memory format people never lose. Songbird turns the
most-used, least-revisited archive people own into something they will play again. See [PRODUCT.md](PRODUCT.md).

## For judges

- **Watch:** the 3-minute demo (link in the submission form). It was filmed from the live site, not mocked up.
- **See the studio in one click:** <https://zootzootzoot.github.io/songbird/>, press **watch one get made**. The
  control room replays a real release's session from what it kept (the cut-outs, the producer's sheet, all four takes
  with their tuner readings and the A&R's verdicts, the sleeve), at 3x speed with the clocks in real time, and hands
  you the music video at the end. Every single on the shelf has **watch it get made** too, and so does the player.
- **Make one:** scroll to the desk, press **borrow someone's day** (eight days that aren't on the shelf, photographed
  by Muse Image) or drop in your own photos, then **produce my day**. About three minutes later you have a single, a
  sleeve and a music video, and **Save the video** gives you a 9:16 MP4. The studio is one GPU, so a release can
  queue behind another.
- **Look at:** the control room. Eleven lamps, one per job, and a lamp is lit only while that model is really
  working. Ten of the eleven jobs are done by eight Meta models.
- **Read:** [docs/META_LOG.md](docs/META_LOG.md), every decision a Meta model made or measured while we built this,
  with the numbers. The commit history runs from Oct 26 to Nov 4.

## How a day becomes a single

| lamp | model | what it does |
|---|---|---|
| LOOK | Muse Spark 1.3 | reads every photo at once, finds what the day was about and the order it happened in |
| CUT | SAM 3.1 | cuts the one thing Spark named out of each photo: these become the band |
| PRODUCE | Muse Wonder 1.0 | calls the genre (with a reason), casts the band, writes the song, a line per photo |
| DRESS | Muse Image 1.0 + SAM 3.1 | redraws each cut-out as its band role, in the genre's wardrobe |
| SLEEVE | Muse Image 1.0 | paints a genre-authentic sleeve from the day's own cut-outs |
| DIRECT | Muse Spark 1.3 | writes the video's shot list from the lyrics, the band and the genre |
| RECORD | ACE-Step 1.5 XL (open weights, local GPU) | records four takes, while the three jobs above run |
| TUNE | Demucs (Meta, open weights, local GPU) | splits the singer from the band and cuts any take under 75% in key |
| A&R | Muse Spark 1.2 (audio in) | listens to the takes that passed and keeps one, with a verdict |
| CHECK | Muse Voice Transcribe | hears the kept vocal and finds which lyric lines were really sung |
| TIME | MMS forced aligner (Meta, open weights, local GPU) | places every sung word to the 20 ms frame, so the video's lyrics land on the beat |

Everything a model decided is in the tape and on screen: the genre and why, the band roles, each take's tuner reading
and the A&R verdict. [docs/META_LOG.md](docs/META_LOG.md) records every problem the Meta models solved while building it.

## Three surfaces

- **The front door** (daylight): things from other people's days float in the sky, and each one opens its single.
  It also holds the shelf of releases, why songs matter, and the desk where you make your own.
- **The control room** (night): the live session. Every model is a lamp, takes arrive, and the tuner and A&R decide.
- **The video**: full-screen, with its own art direction for each genre. It performs the director's shot list with
  the cast band. "Save the video" gives you a 9:16 MP4 of it with the song, for Reels, Stories or a group chat (on a
  phone it opens the share sheet). The server films the real video page in a headless browser and muxes the song
  under it with ffmpeg ([server/songbird/render.py](server/songbird/render.py)).

Design: [DESIGN.md](DESIGN.md). API contract: [docs/CONTRACT.md](docs/CONTRACT.md).

## Run it

```
# .env at the repo root: MODEL_API_KEY=...   (Meta Model API)
cd server && .venv\Scripts\python.exe -m uvicorn songbird.app:app --port 8787
cd web && npm install && npm run dev          # http://localhost:5173
```

The band (ACE-Step 1.5 XL + Demucs) runs as a worker process on a local CUDA GPU and warms up on server start.

Live at <https://zootzootzoot.github.io/songbird/>. The site and the shelf (songs, videos, MP4s) are static on GitHub
Pages and play on their own; making a new single goes through a Cloudflare tunnel to the GPU studio on our PC:

```
server\.venv\Scripts\python.exe deploy\publish_pages.py     # build and publish the site and the shelf
server\.venv\Scripts\python.exe deploy\serve.py             # keep the studio, the tunnel and live.json up
```

## Sample days

The nine days on the shelf were photographed by Muse Image ([server/scripts/gen_days.py](server/scripts/gen_days.py)),
so no real person's photos are used. The floating objects on the front door were redrawn by Muse Image from those
photos ([server/scripts/gen_objects.py](server/scripts/gen_objects.py)). Every song, band, sleeve and video came out of
the same pipeline a visitor's day goes through.
