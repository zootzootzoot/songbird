"""Keeps the ACE-Step session band (band_worker.py, in its own venv) warm, and queues recording sessions."""
from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from pathlib import Path

from . import config

WORKER = Path(__file__).with_name("band_worker.py")
ACE_DIR = Path(os.environ.get("ACE_DIR", config.ROOT.parent / "rea-work/acestep"))
ACE_PY = ACE_DIR / ".venv/Scripts/python.exe"


class Band:
    def __init__(self):
        self.proc: subprocess.Popen | None = None
        self.ready = threading.Event()
        self.lock = threading.Lock()
        self._listeners: dict[str, callable] = {}
        self._boot = threading.Lock()

    @property
    def available(self) -> bool:
        return ACE_PY.exists()

    def start(self):
        with self._boot:
            if self.proc and self.proc.poll() is None:
                return
            self.ready.clear()
            self.proc = subprocess.Popen(
                [str(ACE_PY), "-u", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=open(config.DATA / "band.log", "a", encoding="utf-8"), text=True, encoding="utf-8", bufsize=1,
                env={**os.environ, "ACE_DIR": str(ACE_DIR), "PYTHONIOENCODING": "utf-8"},
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

    def retime(self, *, lines: list[dict], vocal: str, timeout: float = 180) -> list[dict]:
        """Word times for the record's lines by forced alignment on the kept take's vocal (songbird/fa.py)."""
        got = self._run({"op": "retime", "lines": lines, "vocal": vocal}, timeout)
        return got[0]["lines"] if got else lines

    def record(self, *, caption: str, lyrics: str, bpm: int | None, key: str, duration: float, out_dir: str,
               takes: int = 2, seed: int = 7, on_take=None, timeout: float = 900) -> list[dict]:
        return self._run({"caption": caption, "lyrics": lyrics, "bpm": bpm, "key": key, "duration": duration,
                          "takes": takes, "seed": seed, "out_dir": out_dir}, timeout, on_take)

    def _run(self, payload: dict, timeout: float, on_take=None) -> list[dict]:
        if not (self.proc and self.proc.poll() is None):
            self.start()
        if not self.ready.wait(300):
            raise RuntimeError("the band did not show up")
        with self.lock:
            jid = uuid.uuid4().hex[:8]
            done = threading.Event()
            got: list[dict] = []
            err: dict = {}

            def cb(msg):
                if msg["event"] == "take":
                    got.append(msg)
                    if on_take:
                        on_take(msg)
                elif msg["event"] == "done":
                    done.set()
                elif msg["event"] == "retimed":
                    got.append(msg)
                    done.set()
                elif msg["event"] == "error":
                    err.update(msg)
                    done.set()

            self._listeners[jid] = cb
            try:
                assert self.proc and self.proc.stdin
                self.proc.stdin.write(json.dumps({"id": jid, **payload}) + "\n")
                self.proc.stdin.flush()
                if not done.wait(timeout):
                    raise RuntimeError("the session ran over")
            finally:
                self._listeners.pop(jid, None)
            if err:
                raise RuntimeError(f"band: {err.get('message')}")
            return got


band = Band()
