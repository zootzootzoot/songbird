"""Songbird server: the API, the tapes, and the built web app.

  server\\.venv\\Scripts\\python.exe -m uvicorn songbird.app:app --port 8787   (from server/)
"""
from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, meta, pipeline, render
from .band import band

app = FastAPI(title="songbird")
app.add_middleware(CORSMiddleware, allow_origins=["https://zootzootzoot.github.io", "http://localhost:5173",
                                                  "http://127.0.0.1:5173", "http://localhost:4173"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])
config.TAPES.mkdir(parents=True, exist_ok=True)
SAMPLES = config.DATA / "samples.json"   # ids of finished tapes shown on the shelf
WEB = config.ROOT / "web" / "dist"


@app.on_event("startup")
def _warm():
    if band.available:
        threading.Thread(target=band.start, daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True, "meta": bool(config.META_KEY), "band": band.ready.is_set(),
            "busy": pipeline.GPU.locked()}


RECENT: dict[str, list[float]] = {}
DAY: list[float] = []
PER_IP_HOUR = int(__import__("os").environ.get("TAPES_PER_IP_HOUR", "4"))
PER_DAY = int(__import__("os").environ.get("TAPES_PER_DAY", "150"))


def _allow(ip: str) -> str | None:
    now = time.time()
    hits = [t for t in RECENT.get(ip, []) if now - t < 3600]
    RECENT[ip] = hits
    DAY[:] = [t for t in DAY if now - t < 86400]
    if ip not in ("127.0.0.1", "::1") and len(hits) >= PER_IP_HOUR:
        return "this deck has made a lot of tapes for you this hour. play one from the shelf, or come back in a bit"
    if len(DAY) >= PER_DAY:
        return "the deck has run out of tape for today. the shelf still plays"
    hits.append(now)
    DAY.append(now)
    return None


@app.post("/api/tapes")
async def create(request: Request, photos: list[UploadFile] = File(...), name: str | None = Form(None), note: str | None = Form(None),
                 note_spoken: bool = Form(False)):
    if not 3 <= len(photos) <= 6:
        raise HTTPException(400, "feed the deck 3 to 6 pictures or short clips")
    if not config.META_KEY:
        raise HTTPException(503, "the deck has no Meta key")
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    why = _allow(ip)
    if why:
        raise HTTPException(429, why)
    blobs = []
    for p in photos:
        b = await p.read()
        if len(b) > 90 * 1024 * 1024:
            raise HTTPException(413, "one of those is too big (keep videos short)")
        blobs.append(b)
    name = (name or "")[:24]
    note = (note or "")[:160]
    try:
        job = pipeline.new_tape(blobs, name, note, spoken=note_spoken)
    except Exception:
        raise HTTPException(400, "the deck could not read one of the pictures")
    return {"id": job.id}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """A spoken note about the day (one thing the photos can't show), via Muse Voice Transcribe."""
    b = await audio.read()
    if len(b) > 8 * 1024 * 1024:
        raise HTTPException(413, "that note is too long")
    try:
        text = await asyncio.to_thread(meta.transcribe, b)
    except Exception as e:
        raise HTTPException(502, f"the deck could not hear that ({str(e)[:120]})")
    return {"text": text[:200]}


@app.get("/api/tapes/{tid}/events")
async def events(tid: str, request: Request):
    job = pipeline.JOBS.get(tid)
    if job is None:
        tape = pipeline.load_tape(tid)
        if not tape:
            raise HTTPException(404, "no such tape")

        async def once():
            yield f"event: done\ndata: {json.dumps({'type': 'done', 'tape': tape})}\n\n"
        return StreamingResponse(once(), media_type="text/event-stream")

    async def stream():
        sent = 0
        while True:
            if await request.is_disconnected():
                return
            with job.cond:
                batch = job.events[sent:]
                finished = job.finished
            for ev in batch:
                yield f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n"
            sent += len(batch)
            if finished and sent >= len(job.events):
                return
            if not batch:
                yield ": tick\n\n"
                await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/tapes/{tid}")
def get_tape(tid: str):
    tape = pipeline.load_tape(tid)
    if not tape:
        raise HTTPException(404, "not finished yet")
    return tape


@app.get("/api/tapes/{tid}/share")
def share_status(tid: str):
    """The shareable MP4 (9:16, the music video with the song): its state, and its URL when ready."""
    if not pipeline.load_tape(tid):
        raise HTTPException(404, "no such release")
    return render.status(tid)


@app.get("/api/tapes/{tid}/share.mp4")
def share_file(tid: str):
    f = config.TAPES / tid / "share.mp4"
    tape = pipeline.load_tape(tid)
    if not tape or not f.exists():
        raise HTTPException(404, "not cut yet")
    name = re.sub(r"[^a-z0-9]+", "-", f"{tape.get('catalog', 'sb')} {tape.get('title', '')}".lower()).strip("-")
    return FileResponse(f, media_type="video/mp4", filename=f"songbird-{name}.mp4")


@app.post("/api/tapes/{tid}/share")
def share_make(tid: str):
    if not pipeline.load_tape(tid):
        raise HTTPException(404, "no such release")
    return render.queue(tid)


@app.get("/api/samples")
def samples():
    ids = json.loads(SAMPLES.read_text()) if SAMPLES.exists() else []
    out = []
    for tid in ids:
        t = pipeline.load_tape(tid)
        if t:
            out.append({"id": t["id"], "title": t["title"], "dedication": t["dedication"], "cover": t["cover"],
                        "catalog": t.get("catalog"), "artist": t.get("artist"), "genre": t.get("genre"), "style": t.get("style"),
                        "duration": t["duration"], "palette": t.get("palette", []), "photos": len(t["photos"])})
    return {"tapes": out}


app.mount("/tapes", StaticFiles(directory=str(config.TAPES)), name="tapes")

def _page(request: Request, tid: str | None):
    """index.html, with link-preview tags for a tape so a shared link unfurls with its cover."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    tape = pipeline.load_tape(tid) if tid and re.fullmatch(r"t_[0-9a-f]{8}", tid) else None
    if tape:
        base = str(request.base_url).rstrip("/")
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            base = base.replace("http://", proto + "://", 1)
        esc = lambda s: (s or "").replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
        title = f"{tape['title']} · songbird"
        desc = f"a {tape.get('genre') or ''} single by {tape.get('artist') or 'songbird'}. {tape.get('liner', '')}"
        img = base + (tape.get("cover") or tape["photos"][0]["src"])
        tags = (f'<meta property="og:title" content="{esc(title)}">'
                f'<meta property="og:description" content="{esc(desc)}">'
                f'<meta property="og:image" content="{esc(img)}">'
                f'<meta property="og:type" content="music.song">'
                f'<meta property="og:audio" content="{esc(base + tape["audio"])}">'
                f'<meta name="twitter:card" content="summary_large_image">'
                f'<meta name="twitter:title" content="{esc(title)}">'
                f'<meta name="twitter:description" content="{esc(desc)}">'
                f'<meta name="twitter:image" content="{esc(img)}">')
        html = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", html, count=1, flags=re.S)
        html = html.replace("</head>", tags + "</head>", 1)
    return HTMLResponse(html)


if WEB.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB / "assets")), name="assets")

    @app.get("/t/{tid}")
    def tape_page(tid: str, request: Request):
        return _page(request, tid)

    @app.get("/{path:path}")
    def spa(path: str, request: Request):
        f = WEB / path
        if path and f.is_file() and WEB in f.resolve().parents:
            return FileResponse(f)
        return _page(request, request.query_params.get("tape"))
