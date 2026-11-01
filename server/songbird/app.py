"""Songbird server: the API, the tapes, and the built web app.

  server\\.venv\\Scripts\\python.exe -m uvicorn songbird.app:app --port 8787   (from server/)
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config, meta, pipeline
from .singer import singer

app = FastAPI(title="songbird")
config.TAPES.mkdir(parents=True, exist_ok=True)
SAMPLES = config.DATA / "samples.json"   # ids of finished tapes shown on the shelf
WEB = config.ROOT / "web" / "dist"


@app.on_event("startup")
def _warm():
    if singer.available:
        threading.Thread(target=singer.start, daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True, "meta": bool(config.META_KEY), "singer": singer.ready.is_set(),
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
        raise HTTPException(400, "feed the deck 3 to 6 pictures")
    if not config.META_KEY:
        raise HTTPException(503, "the deck has no Meta key")
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    why = _allow(ip)
    if why:
        raise HTTPException(429, why)
    blobs = []
    for p in photos:
        b = await p.read()
        if len(b) > 25 * 1024 * 1024:
            raise HTTPException(413, "one of the pictures is too big")
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


@app.get("/api/samples")
def samples():
    ids = json.loads(SAMPLES.read_text()) if SAMPLES.exists() else []
    out = []
    for tid in ids:
        t = pipeline.load_tape(tid)
        if t:
            out.append({"id": t["id"], "title": t["title"], "dedication": t["dedication"], "cover": t["cover"],
                        "duration": t["duration"], "palette": t.get("palette", []), "photos": len(t["photos"])})
    return {"tapes": out}


app.mount("/tapes", StaticFiles(directory=str(config.TAPES)), name="tapes")

if WEB.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB / "assets")), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = WEB / path
        if path and f.is_file() and WEB in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(WEB / "index.html")
