"""The shareable MP4: film the real music video page, then lay the song under it.

A headless Edge opens the video page in render mode (`?tape=<id>&render=1`: portrait, no controls, no audio, plays
on its own from the cold open). We film it in real time with the DevTools screencast, so every CSS animation, beat
pulse and camera move is exactly what a viewer sees, then ffmpeg turns the timestamped frames into 30 fps H.264 and
muxes song.mp3 from the same point in the song (with the same short fade-in). 1080x1920, for Reels, Stories and chats.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
import websockets

from . import config

EDGE = os.environ.get("EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
FFMPEG = os.environ.get("FFMPEG", shutil.which("ffmpeg") or "ffmpeg")
W, H, SCALE = 720, 1280, 1.5  # css px x device scale = 1080 x 1920
HOLD = 3.0  # seconds of the end slate after the song


def web_base() -> str:
    """Where the video page is served: SONGBIRD_WEB, else the Vite dev server if it's up, else this server."""
    if os.environ.get("SONGBIRD_WEB"):
        return os.environ["SONGBIRD_WEB"].rstrip("/") + "/"
    for dev in ("http://localhost:5173/", "http://127.0.0.1:5173/"):  # Vite may listen on ::1 only
        try:
            httpx.get(dev, timeout=1.5)
            return dev
        except httpx.HTTPError:
            pass
    return f"http://127.0.0.1:{config.PORT}/"


def _port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


async def _film(url: str, frames_dir: Path, on_progress=None, limit: float = 330.0, wait_start: float = 25.0) -> dict:
    port = _port()
    prof = tempfile.mkdtemp(prefix="sb-render-")
    edge = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                             f"--window-size={W},{H}", f"--force-device-scale-factor={SCALE}", "--hide-scrollbars",
                             "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--no-first-run",
                             "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                             "--disable-backgrounding-occluded-windows", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(80):
            try:
                pages = httpx.get(f"http://127.0.0.1:{port}/json/list", timeout=1).json()
                target = next((p for p in pages if p.get("type") == "page"), None)
                if target:
                    break
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.25)
        if not target:
            raise RuntimeError("the recorder's browser didn't start")
        async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
            seq = 0
            pending: dict[int, asyncio.Future] = {}
            frames: list[tuple[float, str]] = []

            async def call(method, **params):
                nonlocal seq
                seq += 1
                fut = asyncio.get_running_loop().create_future()
                pending[seq] = fut
                await ws.send(json.dumps({"id": seq, "method": method, "params": params}))
                return await fut

            async def pump():
                async for raw in ws:
                    msg = json.loads(raw)
                    if "id" in msg and msg["id"] in pending:
                        pending.pop(msg["id"]).set_result(msg.get("result", {}))
                    elif msg.get("method") == "Page.screencastFrame":
                        p = msg["params"]
                        name = f"f{len(frames):05d}.jpg"
                        (frames_dir / name).write_bytes(base64.b64decode(p["data"]))
                        frames.append((p["metadata"]["timestamp"], name))
                        await ws.send(json.dumps({"id": 0, "method": "Page.screencastFrameAck",
                                                  "params": {"sessionId": p["sessionId"]}}))

            pumper = asyncio.create_task(pump())
            await call("Page.enable")
            # the exact 9:16 viewport (the headless window's own size loses some pixels to its frame)
            await call("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=SCALE, mobile=False)
            await call("Emulation.setFocusEmulationEnabled", enabled=True)
            await call("Page.startScreencast", format="jpeg", quality=88, maxWidth=int(W * SCALE),
                       maxHeight=int(H * SCALE), everyNthFrame=1)
            await call("Page.navigate", url=url)
            t0, sb, done_at = time.time(), {}, None
            while time.time() - t0 < limit:
                await asyncio.sleep(0.25)
                r = await call("Runtime.evaluate", expression="JSON.stringify(window.__sb || {})", returnByValue=True)
                sb = json.loads(r.get("result", {}).get("value") or "{}")
                if on_progress and sb.get("start"):
                    on_progress(sb)
                if not sb.get("start") and time.time() - t0 > wait_start:
                    break
                if sb.get("end") and done_at is None:
                    done_at = time.time()
                if done_at and time.time() - done_at >= HOLD:
                    break
            await call("Page.stopScreencast")
            pumper.cancel()
            if not sb.get("start"):
                raise RuntimeError("the video never started playing")
            return {"frames": frames, "start": sb["start"] / 1000.0, "from": float(sb.get("from") or 0.0),
                    "end": (sb.get("end") or sb["start"]) / 1000.0}
    finally:
        edge.kill()
        shutil.rmtree(prof, ignore_errors=True)


def render(tid: str, on_progress=None) -> Path:
    """Film tape `tid`'s video and write tapes/<tid>/share.mp4. Returns its path."""
    d = config.TAPES / tid
    out = d / "share.mp4"
    part = d / "share.part.mp4"  # renamed to share.mp4 only once the encode has finished
    work = Path(tempfile.mkdtemp(prefix="sb-frames-"))
    try:
        shot = asyncio.run(_film(f"{web_base()}?tape={tid}&render=1", work, on_progress))
        t0 = shot["start"]
        frames = [(t - t0, n) for t, n in shot["frames"] if t >= t0 - 0.05]
        if len(frames) < 30:
            raise RuntimeError(f"only {len(frames)} frames were filmed")
        length = max(frames[-1][0], shot["end"] - t0 + HOLD)
        # concat list: each frame held until the next one arrived
        lines = []
        for k, (t, n) in enumerate(frames):
            nxt = frames[k + 1][0] if k + 1 < len(frames) else length
            lines += [f"file '{(work / n).as_posix()}'", f"duration {max(0.001, nxt - max(0.0, t)):.4f}"]
        lines.append(f"file '{(work / frames[-1][1]).as_posix()}'")
        (work / "list.txt").write_text("\n".join(lines))
        fade = 0.42 if shot["from"] > 0.5 else 0.0
        cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"),
               "-ss", f"{shot['from']:.3f}", "-i", str(d / "song.mp3"),
               "-map", "0:v", "-map", "1:a", "-vf", f"scale={int(W * SCALE)}:{int(H * SCALE)}:flags=lanczos,fps=30,format=yuv420p",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-maxrate", "3M", "-bufsize", "6M", "-af", f"afade=t=in:d={fade}" if fade else "anull", "-c:a", "aac", "-b:a", "192k",
               "-t", f"{length:.2f}", "-movflags", "+faststart", str(part)]
        subprocess.run(cmd, check=True)
        os.replace(part, out)
        spans = [b[0] - a[0] for a, b in zip(frames, frames[1:])]
        stalls = [f"{a[0]:.1f}s+{b[0] - a[0]:.2f}" for a, b in zip(frames, frames[1:]) if b[0] - a[0] > 0.2]
        print(f"render {tid}: {len(frames)} frames over {length:.1f}s "
              f"({len(frames) / max(1, length):.1f} fps filmed, longest gap {max(spans):.2f}s; "
              f"stalls over 0.2s: {', '.join(stalls[:12]) or 'none'})", flush=True)
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)
        part.unlink(missing_ok=True)


if __name__ == "__main__":
    import sys
    for t in sys.argv[1:]:
        print(render(t))


# ------------------------------------------------------------------ the queue: one film at a time
import threading  # noqa: E402

_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_queue: list[str] = []
_wake = threading.Event()


def status(tid: str) -> dict:
    """{"state": "none"|"queued"|"filming"|"encoding"|"ready"|"error", "progress": 0..1, "url"?: str}"""
    f = config.TAPES / tid / "share.mp4"
    with _lock:
        job = dict(_jobs.get(tid) or {})
    if not job and f.exists():
        return {"state": "ready", "progress": 1.0, "url": f"/tapes/{tid}/share.mp4", "bytes": f.stat().st_size}
    if job.get("state") == "ready" and f.exists():
        job.update(url=f"/tapes/{tid}/share.mp4", bytes=f.stat().st_size)
    return job or {"state": "none", "progress": 0.0}


def queue(tid: str) -> dict:
    with _lock:
        if tid not in _queue and (_jobs.get(tid) or {}).get("state") not in ("queued", "filming", "encoding"):
            _jobs[tid] = {"state": "queued", "progress": 0.0}
            _queue.append(tid)
            _wake.set()
    _ensure_worker()
    return status(tid)


def _set(tid: str, **kw):
    with _lock:
        _jobs.setdefault(tid, {}).update(kw)


def _run():
    while True:
        _wake.wait()
        with _lock:
            tid = _queue.pop(0) if _queue else None
            if not _queue:
                _wake.clear()
        if not tid:
            continue
        try:
            tape = json.loads((config.TAPES / tid / "tape.json").read_text(encoding="utf-8"))
            dur = float(tape.get("duration") or 120)
            _set(tid, state="filming", progress=0.0)

            def tick(sb):
                done = (time.time() - sb["start"] / 1000.0) / max(1.0, dur - float(sb.get("from") or 0) + HOLD)
                _set(tid, progress=round(min(0.9, 0.9 * done), 3))
                if done >= 1:
                    _set(tid, state="encoding")

            render(tid, tick)
            _set(tid, state="ready", progress=1.0)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            _set(tid, state="error", progress=0.0, message=str(e)[:200])


_worker: threading.Thread | None = None


def _ensure_worker():
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_run, daemon=True, name="songbird-render")
        _worker.start()
