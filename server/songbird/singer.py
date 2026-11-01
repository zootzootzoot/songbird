"""Keeps one SoulX-Singer worker process alive (model warm on the GPU) and queues jobs for it."""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from . import config

WORKER = Path(__file__).with_name("singer_worker.py")


class Singer:
    def __init__(self):
        self.proc: subprocess.Popen | None = None
        self.ready = threading.Event()
        self.lock = threading.Lock()      # one song on the GPU at a time
        self._listeners: dict[str, callable] = {}
        self._boot_lock = threading.Lock()
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return config.SOULX_PY.exists()

    def start(self):
        with self._boot_lock:
            if self.proc and self.proc.poll() is None:
                return
            self.ready.clear()
            self.proc = subprocess.Popen(
                [str(config.SOULX_PY), "-u", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=open(config.DATA / "singer.log", "a", encoding="utf-8"), text=True, encoding="utf-8", bufsize=1,
                env={**__import__("os").environ, "SOULX_DIR": str(config.SOULX_DIR), "PYTHONIOENCODING": "utf-8"},
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        assert self.proc and self.proc.stdout
        for raw in self.proc.stdout:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("event") == "ready":
                self.ready.set()
                continue
            cb = self._listeners.get(msg.get("id"))
            if cb:
                cb(msg)
        self.ready.clear()

    def sing(self, segments: list[dict], out: str | None, on_line=None, seed: int = 7, pitch: int = 0, timeout: float = 600,
             seg_dir: str | None = None) -> dict:
        if not (self.proc and self.proc.poll() is None):
            self.start()
        if not self.ready.wait(180):
            raise RuntimeError("the singer did not wake up")
        with self.lock:
            jid = uuid.uuid4().hex[:8]
            done = threading.Event()
            result: dict = {}

            def cb(msg):
                if msg["event"] == "line" and on_line:
                    on_line(msg["index"])
                elif msg["event"] in ("done", "error"):
                    result.update(msg)
                    done.set()

            self._listeners[jid] = cb
            try:
                assert self.proc and self.proc.stdin
                self.proc.stdin.write(json.dumps({"id": jid, "segments": segments, "out": out, "seed": seed, "pitch": pitch, "seg_dir": seg_dir}) + "\n")
                self.proc.stdin.flush()
                if not done.wait(timeout):
                    raise RuntimeError("singing timed out")
            finally:
                self._listeners.pop(jid, None)
            if result.get("event") == "error":
                raise RuntimeError(f"singer: {result.get('message')}")
            return result


singer = Singer()
