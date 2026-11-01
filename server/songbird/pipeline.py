"""One tape, start to finish. Runs in a thread; every step is published as an event for the deck to show."""
from __future__ import annotations

import datetime as dt
import io
import json
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

from . import compose, config, meta, writer
from .singer import singer

JOBS: dict[str, "Job"] = {}
GPU = threading.Lock()  # one tape on the machine at a time; later ones wait their turn


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
    stage = "looking"
    try:
        if GPU.locked():
            job.emit("stage", stage="looking", label="another tape is recording. waiting for the deck")
        with GPU:
            _make(job, d, photos, name, note, lambda s: None)
    except Exception as e:
        traceback.print_exc()
        (d / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        job.emit("error", message=_human(e), stage=stage)


def _human(e: Exception) -> str:
    s = str(e)
    if "401" in s or "403" in s:
        return "the deck could not reach its helpers (the Meta key was refused)"
    if "singer" in s:
        return "the singer lost its voice. try again in a minute"
    return "the tape jammed. " + s[:160]


def _make(job: Job, d: Path, photos: list[Image.Image], name: str | None, note: str | None, _):
    t0 = time.time()
    log = {"timings": {}}

    def mark(k):
        log["timings"][k] = round(time.time() - t0, 2)

    # warm the singer while Meta does its part
    if singer.available:
        threading.Thread(target=singer.start, daemon=True).start()

    # 1. look ------------------------------------------------------------------------------
    job.stage("looking", "looking at the pictures", 0.04)
    look = writer.look(photos)
    mark("look")
    order = look["order"]
    pos = {orig: k for k, orig in enumerate(order)}  # original index -> song position
    for k, orig in enumerate(order):
        photos[orig].save(d / f"photo-{k}.jpg", quality=90)
    for orig, p in enumerate(look["photos"]):
        job.emit("seen", photo=pos[orig], hero=p["hero"], seen=p["seen"])
    job.emit("order", order=list(range(len(order))))
    job.emit("progress", value=0.14)

    # 2. cut (SAM 3.1) and write (Muse Wonder) at the same time -------------------------------
    job.stage("cutting", "cutting out the best bits", 0.16)
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

    job.stage("writing", "writing the words down", 0.22)
    song = None
    used_writer = "Muse Wonder 1.0"
    drafts = log["drafts"] = []

    def on_try(r, s, issues):
        drafts.append({"round": r, "t": round(time.time() - t0, 2), "verses": [v["text"] for v in s["verses"]],
                       "refrain": s["refrain"], "last_line": s["last_line"], "issues": issues})
        if issues:
            job.emit("stage", stage="writing", label="checking the words fit the tune. fixing " +
                     ("one line" if len(issues) == 1 else f"{len(issues)} lines"))
    try:
        song = writer.write(look, name=name, note=note, model="muse-wonder-1.0", effort="high", on_try=on_try)
    except Exception:
        traceback.print_exc()
        used_writer = "Muse Spark 1.3"
        song = writer.write(look, name=name, note=note, model=config.SPARK, effort="high", on_try=on_try)
    mark("write")
    for f in cut_futs:
        f.result()
    mark("cut")
    job.emit("title", title=song["title"].lower())
    job.emit("progress", value=0.45)

    # 3. compose -------------------------------------------------------------------------------
    job.stage("composing", "finding the tune", 0.47)
    song["_moods"] = {orig: look["photos"][orig]["mood"] for orig in range(len(photos))}
    planned = writer.plan_lines(song)
    for ln in planned:
        if ln.photo is not None:
            ln.photo = pos[ln.photo]
    moods = [look["photos"][i]["mood"] for i in range(len(photos))]
    mode = song.get("mode", "major")
    tonic = 65 if mode == "major" else 62
    bpm = max(80, min(104, int(song.get("bpm", 90))))
    meter = 3  # lullabies rock in three; 4/4 lines either crawl or crowd
    energy = min(1.0, 0.2 + 0.15 * sum(m in ("bright", "playful") for m in moods))
    brightness = 0.35 + 0.1 * sum(m in ("bright", "playful") for m in moods) - 0.1 * sum(m == "rainy" for m in moods)
    score = compose.compose(planned, tonic=tonic, mode=mode, bpm=bpm, meter=meter,
                            palette=song.get("palette", "musicbox"), energy=energy,
                            brightness=max(0.1, min(0.9, brightness)))
    (d / "score.json").write_text(json.dumps({"segments": score["segments"], "comp": score["comp"]}, indent=1))
    for ln in score["lines"]:  # the deck prints lowercase
        ln["text"] = ln["text"].lower()
        for w in ln["words"]:
            w["text"] = w["text"].lower()
    for i, ln in enumerate(score["lines"]):
        job.emit("line", index=i, text=ln["text"], photo=ln["photo"])
    mark("compose")

    # 4. the cover, painted while the singer sings ---------------------------------------------
    cover_fut = pool.submit(_cover, d, look, order, cuts, photos, song)

    # 5. sing ----------------------------------------------------------------------------------
    job.stage("singing", "singing it through once", 0.52)
    n = len(score["segments"])
    vocal_path = d / "vocal.wav"
    singer.sing(score["segments"], str(vocal_path),
                on_line=lambda i: (job.emit("sung", index=i), job.emit("progress", value=round(0.52 + 0.3 * (i + 1) / n, 3))))
    mark("sing")

    # 6. arrange + mix -------------------------------------------------------------------------
    job.stage("mixing", "winding it onto the tape", 0.84)
    duration = _mix(score, vocal_path, d / "song.mp3")
    mark("mix")

    # 7. print ---------------------------------------------------------------------------------
    job.stage("printing", "printing the j-card", 0.92)
    cover = None
    try:
        cover = cover_fut.result(timeout=120)
    except Exception:
        traceback.print_exc()
    mark("cover")
    pool.shutdown(wait=False)

    today = dt.date.today()
    tape = {
        "id": job.id,
        "createdAt": dt.datetime.now().isoformat(timespec="seconds"),
        "title": song["title"].lower(),
        "name": name.lower() if name else None,
        "dedication": (f"for {name.lower()}, " if name else "") + _date_words(today),
        "liner": song["liner"],
        "note": note,
        "bpm": bpm, "meter": meter, "key": score["key"],
        "duration": duration,
        "audio": f"/tapes/{job.id}/song.mp3",
        "cover": cover,
        "palette": look.get("palette", [])[:4],
        "photos": [{"src": f"/tapes/{job.id}/photo-{k}.jpg", "cutout": cuts.get(k, (None, None))[0],
                    "box": cuts.get(k, (None, None))[1], "hero": look["photos"][orig]["hero"],
                    "motion": motion.get(k, (None,))[0], "motionBox": motion.get(k, (None, None))[1],
                    "clip": clips.get(k),
                    "seen": look["photos"][orig]["seen"]} for k, orig in enumerate(order)],
        "lines": score["lines"],
        "credits": [
            {"role": "looked at the pictures", "model": "Muse Spark 1.3"},
            {"role": "cut out the stickers" + (" and followed the moving ones" if motion else ""), "model": "SAM 3.1"},
            {"role": "wrote the words", "model": used_writer},
            {"role": "painted the cover", "model": "Muse Image 1.0"} if cover else None,
            {"role": "wrote the tune", "model": "songbird composer"},
            {"role": "sang it", "model": "SoulX-Singer (open source)"},
            {"role": "heard your note", "model": "Muse Voice Transcribe"} if getattr(job, "spoken", False) else None,
        ],
    }
    tape["credits"] = [c for c in tape["credits"] if c]
    log["look"], log["song"] = look, {k: v for k, v in song.items() if not k.startswith("_")}
    (d / "tape.json").write_text(json.dumps(tape, indent=1))
    (d / "log.json").write_text(json.dumps(log, indent=1, default=str))
    job.tape = tape
    job.emit("progress", value=1.0)
    job.emit("done", tape=tape)


def _date_words(d: dt.date) -> str:
    return f"{d.strftime('%A').lower()} {d.day} {d.strftime('%B').lower()}"


def _cover(d: Path, look: dict, order: list[int], cuts: dict, photos: list[Image.Image], song: dict) -> str | None:
    heroes = [look["photos"][orig]["hero"] for orig in order]
    refs = []
    for k, orig in enumerate(order):
        if cuts.get(k, (None,))[0]:
            refs.append(Image.open(d / f"cut-{k}.png"))
        else:
            refs.append(photos[orig])
    things = ", ".join(f"the {h}" for h in heroes[:-1]) + f" and the {heroes[-1]}" if len(heroes) > 1 else f"the {heroes[0]}"
    prompt = (f"Cover art for a children's bedtime cassette tape called \"{song['title']}\", in the style of a risograph "
              f"print. Redraw {things} from the reference images as simple, flat, cut-paper shapes, arranged together "
              "in one cosy, playful bedtime scene. Exactly three riso inks on warm cream paper: vermilion red #e0472a, "
              "sunflower yellow #efb02f and deep ocean blue #1d4a68, overprinting where they meet, visible halftone "
              "grain, slight misregistration, hand-made like a 1970s picture book. Leave the top third calm and mostly "
              "empty for a title. No text, no letters, no people, no faces of children.")
    im = meta.paint(prompt, refs, size="1024x1536")
    im.save(d / "cover.png")
    return f"/tapes/{d.name}/cover.png"


def _mix(score: dict, vocal_path: Path, out: Path) -> float:
    import soundfile as sf
    vocal, sr = sf.read(str(vocal_path), dtype="float32")
    try:
        from . import arrange
        return round(float(arrange.mix(score["comp"], vocal, sr, str(out), str(out.with_suffix(".wav")))), 3)
    except Exception:
        traceback.print_exc()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(vocal_path), "-ar", "44100", "-b:a", "192k", str(out)],
                       check=True)
        return round(len(vocal) / sr, 3)


def load_tape(tid: str) -> dict | None:
    f = config.TAPES / tid / "tape.json"
    return json.loads(f.read_text()) if f.exists() else None
