"""One release, start to finish. Runs in a thread; every step is published as an event for the deck to show.

look (Muse Spark 1.3) → cut (SAM 3.1) ∥ produce (Muse Wonder) → record 4 takes (ACE-Step 1.5 XL) → tune (Demucs) → listen (Muse Spark 1.2) ∥ sleeve (Muse Image)
→ listen back (Muse Spark 1.2, audio in) → keep the best take → press.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from pathlib import Path

from PIL import Image, ImageOps

from . import align, cast, compose, config, director, meta, producer, writer
from .band import band

JOBS: dict[str, "Job"] = {}
GPU = threading.Lock()  # one release on the machine at a time; later ones wait their turn
TAKES = 4  # the band records four takes
IN_KEY = 0.75  # the tuner cuts takes with less of the singing on the band's scale (in-key vocals measure 0.83-0.96)


class Job:
    def __init__(self, tid: str):
        self.id = tid
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self.finished = False
        self.tape: dict | None = None

    def emit(self, type_: str, **data):
        with self.cond:
            self.events.append({"type": type_, **data})
            if type_ in ("done", "error"):
                self.finished = True
            self.cond.notify_all()

    def stage(self, stage: str, label: str, progress: float):
        self.emit("stage", stage=stage, label=label)
        self.emit("progress", value=round(progress, 3))


def new_tape(images: list[bytes], name: str | None, note: str | None, spoken: bool = False) -> Job:
    tid = "t_" + uuid.uuid4().hex[:8]
    job = Job(tid)
    JOBS[tid] = job
    d = config.TAPES / tid
    d.mkdir(parents=True, exist_ok=True)
    photos = []
    job.clips = {}  # upload index -> (clip mp4 bytes, frames) for videos
    for i, raw in enumerate(images):
        try:
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
            im.thumbnail((1600, 1600))
        except Exception:  # not a picture: a short video clip
            im, clip, frames = _read_clip(raw, d / f"upload-{i}")
            job.clips[i] = (clip, frames)
        photos.append(im)
    job.spoken = spoken and bool((note or "").strip())
    threading.Thread(target=_run, args=(job, d, photos, (name or "").strip() or None, (note or "").strip() or None),
                     daemon=True).start()
    return job


def _read_clip(raw: bytes, stem: Path, seconds: float = 3.0, fps: int = 12, side: int = 640):
    """A video upload → (a sharp still from its middle, a short 640px clip for SAM, that clip's frames)."""
    src = stem.with_suffix(".src")
    src.write_bytes(raw)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
                           capture_output=True, text=True)
    try:
        dur = float(probe.stdout.strip())
    except ValueError:
        raise ValueError("unreadable upload")
    start = max(0.0, dur / 2 - seconds / 2)
    clip = stem.with_suffix(".mp4")
    vf = f"fps={fps},scale='if(gt(iw,ih),{side},-2)':'if(gt(iw,ih),-2,{side})'"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{seconds}", "-i", str(src), "-an",
                    "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip)], check=True)
    still = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start + seconds / 2:.2f}", "-i", str(src), "-frames:v", "1",
                            "-vf", "scale='min(1600,iw)':-2", "-f", "image2pipe", "-vcodec", "png", "-"],
                           capture_output=True, check=True).stdout
    raw_frames = subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-f", "image2pipe", "-vcodec", "png", "-"],
                                capture_output=True, check=True).stdout
    sig = b"\x89PNG\r\n\x1a\n"
    frames = [Image.open(io.BytesIO(sig + part)).convert("RGB") for part in raw_frames.split(sig)[1:]]
    src.unlink(missing_ok=True)
    return Image.open(io.BytesIO(still)).convert("RGB"), clip.read_bytes(), frames


def _run(job: Job, d: Path, photos: list[Image.Image], name: str | None, note: str | None):
    try:
        if GPU.locked():
            job.emit("stage", stage="looking", label="another release is in the studio. waiting our turn")
        with GPU:
            _make(job, d, photos, name, note)
    except Exception as e:
        traceback.print_exc()
        (d / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        job.emit("error", message=_human(e))


def _human(e: Exception) -> str:
    s = str(e)
    if "401" in s or "403" in s:
        return "the label could not reach its people (the Meta key was refused)"
    if "band" in s or "session" in s:
        return "the session band walked out. try again in a minute"
    return "the tape jammed. " + s[:160]


def _make(job: Job, d: Path, photos: list[Image.Image], name: str | None, note: str | None):
    t0 = time.time()
    log = {"timings": {}}

    def mark(k):
        log["timings"][k] = round(time.time() - t0, 2)

    if band.available:  # wake the session band while Meta does its part
        threading.Thread(target=band.start, daemon=True).start()

    # 1. look (Muse Spark 1.3) ---------------------------------------------------------------
    job.stage("looking", "looking at today", 0.04)
    look = writer.look(photos)
    mark("look")
    order = look["order"]
    pos = {orig: k for k, orig in enumerate(order)}  # original index -> song position
    for k, orig in enumerate(order):
        photos[orig].save(d / f"photo-{k}.jpg", quality=90)
    for orig, p in enumerate(look["photos"]):
        job.emit("seen", photo=pos[orig], hero=p["hero"], seen=p["seen"])
    job.emit("order", order=list(range(len(order))))
    job.emit("progress", value=0.1)

    # 2. cut (SAM 3.1) while the producer works (Muse Wonder) ---------------------------------
    job.stage("cutting", "casting the band", 0.12)
    pool = ThreadPoolExecutor(max_workers=4)
    cuts: dict[int, tuple] = {}
    motion: dict[int, tuple] = {}
    clips: dict[int, str] = {}

    def cut(orig: int):
        p = look["photos"][orig]
        res = None
        for phrase in (p["hero"], p["hero_alt"]):
            try:
                res = meta.cutout(photos[orig], phrase)
            except Exception:
                traceback.print_exc()
                res = None
            if res:
                break
        k = pos[orig]
        if res:
            img, box = res
            img.save(d / f"cut-{k}.png")
            cuts[k] = (f"/tapes/{job.id}/cut-{k}.png", [round(float(x), 4) for x in box])
        else:
            cuts[k] = (None, None)
        if orig in job.clips:  # a video: SAM 3.1 follows the hero through the clip → a moving sticker
            clip, frames = job.clips[orig]
            (d / f"clip-{k}.mp4").write_bytes(clip)
            clips[k] = f"/tapes/{job.id}/clip-{k}.mp4"
            for phrase in (p["hero"], p["hero_alt"]):
                try:
                    mv = meta.video_cutout(frames, clip, phrase)
                except Exception:
                    traceback.print_exc()
                    mv = None
                if mv:
                    fr, mbox = mv
                    fr[0].save(d / f"move-{k}.webp", save_all=True, append_images=fr[1:], duration=round(1000 / 12),
                               loop=0, quality=82, method=4)
                    motion[k] = (f"/tapes/{job.id}/move-{k}.webp", [round(float(x), 4) for x in mbox])
                    break
        job.emit("cut", photo=k, cutout=cuts[k][0], box=cuts[k][1],
                 motion=motion.get(k, (None,))[0], motionBox=motion.get(k, (None, None))[1], clip=clips.get(k))

    cut_futs = [pool.submit(cut, i) for i in range(len(photos))]

    job.stage("producing", "the producer is thinking", 0.2)
    drafts = log["drafts"] = []

    def on_try(r, s, issues):
        drafts.append({"round": r, "t": round(time.time() - t0, 2), "genre": s.get("genre"),
                       "lyrics": producer.lyrics_text(s), "issues": issues})
        if issues:
            job.emit("stage", stage="producing", label="the checker binned a demo. " +
                     ("one note" if len(issues) == 1 else f"{len(issues)} notes"))

    used_writer = "Muse Wonder 1.0"
    try:
        song = producer.write(look, order, name, note, on_try=on_try)
    except Exception:
        traceback.print_exc()
        used_writer = "Muse Spark 1.3"
        song = producer.write(look, order, name, note, on_try=on_try, model=config.SPARK)
    mark("produce")
    bpm = max(60, min(170, int(song.get("bpm", 100))))
    job.emit("genre", genre=song["genre"].lower(), why=song["why"], bpm=bpm, key=song["key"])
    job.emit("title", title=song["title"].lower())
    sheet = []  # sung order, choruses repeated as written
    for s in song["sections"]:
        for ln in s["lines"]:
            ph = ln.get("photo")
            sheet.append({"text": ln["text"].strip().lower(), "section": s["tag"],
                          "kind": "chorus" if s["tag"] == "Chorus" else "verse" if s["tag"].startswith("Verse") else "other",
                          "photo": ph if isinstance(ph, int) and 0 <= ph < len(order) else None})
    for i, ln in enumerate(sheet):
        job.emit("line", index=i, text=ln["text"], photo=ln["photo"], section=ln["section"])
    for f in cut_futs:
        f.result()
    mark("cut")
    for b in song["band"]:
        if 0 <= b["photo"] < len(order):
            job.emit("band", photo=b["photo"], role=b["role"].lower())
    job.emit("progress", value=0.42)

    # 3. the sleeve and the cast, painted while the band records --------------------------------
    cover_fut = pool.submit(_cover, d, look, order, cuts, photos, song)
    casting = ThreadPoolExecutor(max_workers=6)
    roles = {b["photo"]: b["role"] for b in song["band"] if 0 <= b["photo"] < len(order)}
    cast_list = [{"photo": k, "hero": look["photos"][orig]["hero"], "role": roles.get(k, "band member")}
                 for k, orig in enumerate(order) if k in roles]
    # the director writes the video's shot list from the sheet while the band records
    direction_fut = casting.submit(director.direct, song["title"].lower(), song["genre"].lower(), bpm, cast_list,
                                   [{**ln, "start": 0.0} for ln in sheet])
    performer_futs = {k: casting.submit(_cast, job, d, k, photos[orig], look["photos"][orig]["hero"],
                                        roles.get(k, "band member"), song)
                      for k, orig in enumerate(order)}

    # 4. record (ACE-Step 1.5) -----------------------------------------------------------------
    job.stage("recording", "rolling tape", 0.45)
    lyrics = producer.lyrics_text(song)
    caption, style = song["caption"].strip().rstrip("."), song.get("style", "")
    if not caption.lower().startswith(style.lower()):  # the style word leads and closes: it steers the band most
        caption = f"{style}, {caption}"
    if not caption.lower().endswith(style.lower()):
        caption = f"{caption}, {style}"
    # ~11 beats a line: at 8 the singer dropped lines to fit (SB-0012: 12-18 of 21 sung at 90 s, 19-20 at 120 s)
    duration = max(75.0, min(195.0, len(sheet) * 11 * 60 / bpm + 14))
    taken = band.record(caption=caption, lyrics=lyrics, bpm=bpm, key=song["key"], duration=duration,
                        out_dir=str(d / "takes"), takes=TAKES, seed=int(time.time()) % 10000,
                        on_take=lambda m: job.emit("take", index=m["index"],
                                                   audio=f"/tapes/{job.id}/takes/take-{m['index']}.mp3",
                                                   **(m.get("tuning") or {})))
    mark("record")
    job.emit("progress", value=0.7)

    # 5. listen back (Muse Spark 1.2, audio in) and keep the best take ---------------------------
    job.stage("listening", "the producer is listening back", 0.72)
    # the tuner already heard every take; only the ones whose singer stayed in the band's key reach the producer
    in_key = lambda i: (taken[i].get("tuning") or {}).get("inKey") or 0.0
    heard = [i for i in range(len(taken)) if in_key(i) >= IN_KEY] or sorted(range(len(taken)), key=in_key)[-2:]
    verdicts = [None] * len(taken)
    # while Spark listens, Voice Transcribe hears each take's isolated vocal so we know which lines were really sung
    aligned = dict(zip(heard, pool.map(lambda i: _align(taken[i], sheet), heard)))
    for i, v in zip(heard, pool.map(lambda i: _listen(taken[i], song, lyrics), heard)):
        verdicts[i] = v
    sung = {i: (sum(ln["sung"] for ln in a) / len(a) if a else None) for i, a in aligned.items()}
    for i in range(len(taken)):
        if verdicts[i] is None:
            t = taken[i].get("tuning") or {}
            verdicts[i] = {"score": 0.0, "voice": 0.0, "words": 0.0, "genre": 0.0, "cut": True,
                           "verdict": f"cut by the tuner: only {round(in_key(i) * 100)}% of the singing sat in the "
                                      f"band's {t.get('bandKey') or 'key'}"}
    # Spark's taste, plus a take that actually sings the whole sheet beats one that drops verses
    best = max(heard, key=lambda i: verdicts[i]["score"] + 4 * (sung.get(i) if sung.get(i) is not None else 0.5))
    for i, v in enumerate(verdicts):
        v["sung"] = sung.get(i)
        job.emit("verdict", index=i, score=v["score"], voice=v["voice"], words=v["words"], genre=v["genre"],
                 verdict=v["verdict"], kept=i == best, cut=bool(v.get("cut")), inKey=in_key(i), sung=sung.get(i))
    mark("listen")
    shutil.copy2(taken[best]["path"], d / "song.mp3")
    length = _duration(d / "song.mp3")
    if aligned.get(best):  # what was heard; lines the singer skipped are left off the record
        kept_lines = [i for i, ln in enumerate(aligned[best]) if ln["sung"]]
        timed = [{k: v for k, v in aligned[best][i].items() if k != "sung"} for i in kept_lines]
    else:
        kept_lines = list(range(len(sheet)))
        timed = _timeline(sheet, taken[best].get("lrc", ""), length)

    # 6. press ---------------------------------------------------------------------------------
    job.stage("pressing", "pressing the cassette", 0.88)
    cover = None
    try:
        cover = cover_fut.result(timeout=150)
    except Exception:
        traceback.print_exc()
    mark("cover")
    performers = {}
    for k, f in performer_futs.items():
        try:
            performers[k] = f.result(timeout=120)
        except Exception:
            traceback.print_exc()
    casting.shutdown(wait=False)
    mark("cast")
    try:
        direction = direction_fut.result(timeout=90)
        if direction:  # one shot per line that made the record
            direction["shots"] = [direction["shots"][i] for i in kept_lines if i < len(direction["shots"])]
    except Exception:
        traceback.print_exc()
        direction = None
    mark("direct")
    pool.shutdown(wait=False)

    today = dt.date.today()
    tape = {
        "id": job.id,
        "catalog": _catalog(),
        "createdAt": dt.datetime.now().isoformat(timespec="seconds"),
        "title": song["title"].lower(),
        "artist": (song.get("artist") or (f"{name} and the band" if name else "the band")).lower(),
        "name": name.lower() if name else None,
        "dedication": (f"{name.lower()}'s " if name else "") + _date_words(today),
        "genre": song["genre"].lower(), "why": song["why"], "caption": caption, "style": song.get("style"),
        "liner": song["liner"],
        "note": note,
        "bpm": bpm, "key": (taken[best].get("tuning") or {}).get("bandKey") or song["key"],
        "duration": round(length, 2),
        "audio": f"/tapes/{job.id}/song.mp3",
        "takes": [{"audio": f"/tapes/{job.id}/takes/take-{i}.mp3", "kept": i == best, "cut": bool(v.get("cut")),
                   **{k: v.get(k) for k in ("score", "voice", "words", "genre", "verdict", "sung")},
                   **(taken[i].get("tuning") or {})} for i, v in enumerate(verdicts)],
        "cover": cover,
        "palette": look.get("palette", [])[:4],
        "photos": [{"src": f"/tapes/{job.id}/photo-{k}.jpg", "cutout": cuts.get(k, (None, None))[0],
                    "box": cuts.get(k, (None, None))[1], "hero": look["photos"][orig]["hero"],
                    "motion": motion.get(k, (None,))[0], "motionBox": motion.get(k, (None, None))[1],
                    "clip": clips.get(k), "seen": look["photos"][orig]["seen"], "performer": performers.get(k)}
                   for k, orig in enumerate(order)],
        "band": [{"photo": b["photo"], "role": b["role"].lower()} for b in song["band"] if 0 <= b["photo"] < len(order)],
        "lines": timed,
        "direction": direction,
        "credits": [c for c in [
            {"role": "looked at today", "model": "Muse Spark 1.3"},
            {"role": "cut out the band" + (" and followed the moving ones" if motion else ""), "model": "SAM 3.1"},
            {"role": "produced and wrote it", "model": used_writer},
            {"role": "session band", "model": "ACE-Step 1.5 XL (open source)"},
            {"role": "tuned the takes (split the singer from the band)", "model": "Demucs (Meta, open source)"},
            {"role": "listened back, picked the take", "model": "Muse Spark 1.2"},
            {"role": "painted the sleeve", "model": "Muse Image 1.0"} if cover else None,
            {"role": "dressed the band for the genre", "model": "Muse Image 1.0 + SAM 3.1"} if any(performers.values()) else None,
            {"role": "directed the video", "model": "Muse Spark 1.3"} if direction else None,
            {"role": "heard your note", "model": "Muse Voice Transcribe"} if getattr(job, "spoken", False) else None,
        ] if c],
    }
    log["look"], log["song"], log["verdicts"] = look, song, verdicts
    (d / "tape.json").write_text(json.dumps(tape, indent=1))
    (d / "log.json").write_text(json.dumps(log, indent=1, default=str))
    job.tape = tape
    job.emit("progress", value=1.0)
    job.emit("done", tape=tape)


def _align(take: dict, sheet: list[dict]) -> list[dict] | None:
    if not take.get("vocal"):
        return None
    try:
        import soundfile as sf
        return align.align(take["vocal"], sheet, sf.info(take["vocal"]).duration)
    except Exception:
        traceback.print_exc()
        return None


def _cast(job, d: Path, k: int, photo: Image.Image, hero: str, role: str, song: dict) -> str | None:
    """Muse Image redraws photo k's hero as its band role in the genre's wardrobe; keyed out -> cast-k.png."""
    try:
        cut = Image.open(d / f"cut-{k}.png") if (d / f"cut-{k}.png").exists() else None
        r = cast.performer(photo, cut, hero, role, song["genre"], song.get("style"))
    except Exception:
        traceback.print_exc()
        return None
    if not r:
        return None
    r[0].save(d / f"cast-{k}.png")
    r[1].save(d / f"cast-{k}-art.png")  # the painting, so the key can be redone without repainting
    url = f"/tapes/{job.id}/cast-{k}.png"
    job.emit("performer", photo=k, src=url)
    return url


def _listen(take: dict, song: dict, lyrics: str) -> dict:
    try:
        return producer.listen(take["path"], song["genre"], lyrics)
    except Exception:
        traceback.print_exc()
        return {"voice": 5, "words": 5, "genre": 5, "heard": "", "verdict": "the producer had headphone trouble.",
                "score": 5.0}


def _duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def _timeline(sheet: list[dict], lrc: str, length: float) -> list[dict]:
    """Line start times from the band's LRC (matched in order); word times spread across each line by syllables."""
    stamps = []
    for m in re.finditer(r"\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)", lrc or ""):
        text = m.group(3).strip()
        if text and not re.fullmatch(r"\[.*\]", text):
            stamps.append((int(m.group(1)) * 60 + float(m.group(2)), re.sub(r"[^a-z ]", "", text.lower())))
    starts: list[float | None] = [None] * len(sheet)
    j = 0
    for i, ln in enumerate(sheet):  # walk both in order, tolerating a skipped or merged line
        key = re.sub(r"[^a-z ]", "", ln["text"])
        for k in range(j, min(j + 3, len(stamps))):
            if SequenceMatcher(None, key.split(), stamps[k][1].split()).ratio() > 0.5:
                starts[i], j = stamps[k][0], k + 1
                break
    known = [(i, s) for i, s in enumerate(starts) if s is not None]
    if not known:  # no timestamps: spread the lines over the middle of the song
        a, b = 0.1 * length, 0.92 * length
        starts = [a + (b - a) * i / len(sheet) for i in range(len(sheet))]
    else:
        for i in range(len(sheet)):  # interpolate the gaps
            if starts[i] is None:
                prev = max((k for k in known if k[0] < i), default=None, key=lambda k: k[0])
                nxt = min((k for k in known if k[0] > i), default=None, key=lambda k: k[0])
                if prev and nxt:
                    starts[i] = prev[1] + (nxt[1] - prev[1]) * (i - prev[0]) / (nxt[0] - prev[0])
                elif prev:
                    starts[i] = prev[1] + 3.2 * (i - prev[0])
                else:
                    starts[i] = max(0.0, nxt[1] - 3.2 * (nxt[0] - i))
    out = []
    for i, ln in enumerate(sheet):
        s = float(starts[i])
        nxt = float(starts[i + 1]) if i + 1 < len(sheet) else min(length, s + 6)
        e = s + min(max(1.0, nxt - s - 0.15), 7.0)
        shown = re.findall(r"[a-z][a-z'\-]*[^\sa-z]*", ln["text"]) or [ln["text"]]
        weights = [max(1, compose.count_syllables(w)) for w in shown]
        tot, acc, words = sum(weights), s, []
        for w, n in zip(shown, weights):
            dur = (e - s) * n / tot
            words.append({"text": w, "start": round(acc, 3), "end": round(acc + dur, 3)})
            acc += dur
        out.append({**ln, "start": round(s, 3), "end": round(e, 3), "words": words})
    return out


def _catalog() -> str:
    f = config.DATA / "catalog.txt"
    n = (int(f.read_text().strip() or 0) if f.exists() else 0) + 1
    f.write_text(str(n))
    return f"SB-{n:04d}"


def _date_words(d: dt.date) -> str:
    return f"{d.strftime('%A').lower()} {d.day} {d.strftime('%B').lower()}"


# How real sleeves in each repertoire style looked, so Muse Image dates the cover at a glance.
COVER_LOOK = {
    "synthwave": "1984 synth LP: airbrushed chrome and neon, magenta-to-violet sky, laser grid horizon, glossy",
    "italo disco": "1983 Italian disco 12-inch: airbrushed neon on black, chrome, geometric shapes, glossy and cheap",
    "synth-pop": "1982 synth-pop single: cool minimal studio photo, flat pastel blocks, Saville-style restraint",
    "eurodance": "1994 eurodance CD single: saturated rave colours, lens flares, 3D chrome, laser lights",
    "funk": "1975 funk LP: wild psychedelic illustration, platform boots, cosmic, saturated oranges and purples",
    "soul": "1970 soul LP: warm studio portrait photography, rich brown and gold, soft vignette",
    "big band": "1940s big band 78 album: art deco frame, black and gold, spotlight, engraved feel",
    "bossa nova": "1963 Blue Note / Verve LP: duotone photo in one colour plus black, huge negative space, Reid Miles",
    "rock and roll": "1957 rock and roll LP: hand-tinted photo, bold primary colours, starburst, jukebox gloss",
    "rockabilly": "1956 Sun Records sleeve: black and white photo with one saturated colour, flames and dice motifs",
    "surf rock": "1963 surf LP: sun-bleached Kodachrome beach photo, turquoise and sunset orange, waves",
    "power ballad": "1987 power ballad single: soft-focus glamour photo, haze, backlight, lens flare, purple dusk",
    "hard rock": "1986 glam metal LP: airbrushed chrome lettering-free logo shapes, electric blue lightning, neon pink and black stage lights",
    "indie rock": "1994 indie 7-inch: grainy snapshot, washed colour, lo-fi, off-centre crop",
    "punk": "1977 punk single: photocopied black and white, ransom-note collage, fluorescent pink and yellow",
    "chiptune": "1989 game cartridge box art: bold pixel art, CRT glow, saturated primaries",
    "ska": "1979 2 Tone Records single: black and white checkerboard, stark high-contrast photo, one red accent",
    "tango": "1950s Argentine tango LP: hand-tinted photo, ornate frame, oxblood, black and cream",
    "salsa": "1974 Fania Records LP: bold colour photo, hot saturated blocks, tropical, brassy and loud",
}


def _cover(d: Path, look: dict, order: list[int], cuts: dict, photos: list[Image.Image], song: dict) -> str | None:
    heroes = [look["photos"][orig]["hero"] for orig in order]
    refs = []
    for k, orig in enumerate(order):
        if cuts.get(k, (None,))[0]:
            refs.append(Image.open(d / f"cut-{k}.png"))
        else:
            refs.append(photos[orig])
    things = ", ".join(f"the {h}" for h in heroes[:-1]) + f" and the {heroes[-1]}" if len(heroes) > 1 else f"the {heroes[0]}"
    prompt = (f"The front cover of a {song['genre']} single called \"{song['title']}\", made exactly the way real "
              f"{song.get('style') or song['genre']} record sleeves of that era were made: their photography or "
              f"illustration style, colour, printing, typography-free layout and graphic attitude, so a record collector "
              f"would date it at a glance. The band is {things}: redraw them from the reference images as the stars of "
              "the cover, posed like the band on a classic sleeve of that genre. "
              + (f"The look: {COVER_LOOK[song.get('style')]}. " if song.get("style") in COVER_LOOK else "")
              + "Square. No text, no letters, no logos, no people, no faces of children.")
    try:
        im = meta.paint(prompt, refs, size="1024x1024")
    except RuntimeError as e:  # Muse Image's filter refused a look once ("pyro"); the plain brief still makes a sleeve
        if "content" not in str(e) or song.get("style") not in COVER_LOOK:
            raise
        im = meta.paint(prompt.replace(f"The look: {COVER_LOOK[song['style']]}. ", ""), refs, size="1024x1024")
    im.save(d / "cover.png")
    im.convert("RGB").save(d / "cover.jpg", quality=88, optimize=True)  # the web only needs the jpeg
    return f"/tapes/{d.name}/cover.jpg"


def load_tape(tid: str) -> dict | None:
    f = config.TAPES / tid / "tape.json"
    return json.loads(f.read_text()) if f.exists() else None
