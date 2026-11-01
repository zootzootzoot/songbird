"""Keep Songbird live from this PC: the API server, a Cloudflare quick tunnel, and live.json on GitHub Pages.

  server\\.venv\\Scripts\\python.exe deploy\\serve.py

Checks every 30 s. If the server dies it is restarted; if the tunnel dies or stops answering, a new one is opened
and the Pages site is pointed at it. Ctrl-C marks the deck offline (the shelf keeps playing).
"""
from __future__ import annotations

import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / "server" / ".venv" / "Scripts" / "python.exe"
CLOUDFLARED = r"C:\Program Files (x86)\cloudflared\cloudflared.exe"
LOCAL = "http://127.0.0.1:8787"
LOG = ROOT / "server" / "data" / "serve.log"


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def healthy(base: str, timeout: float = 8) -> bool:
    try:
        return httpx.get(base + "/api/health", timeout=timeout).json().get("ok") is True
    except Exception:
        return False


def start_server() -> subprocess.Popen:
    log("starting server")
    p = subprocess.Popen([str(PY), "-m", "uvicorn", "songbird.app:app", "--host", "127.0.0.1", "--port", "8787"],
                         cwd=ROOT / "server", stdout=open(ROOT / "server/data/server.log", "a"), stderr=subprocess.STDOUT)
    for _ in range(60):
        if healthy(LOCAL, 2):
            return p
        time.sleep(1)
    raise RuntimeError("server did not come up")


def start_tunnel() -> tuple[subprocess.Popen, str]:
    log("opening tunnel")
    p = subprocess.Popen([CLOUDFLARED, "tunnel", "--no-autoupdate", "--url", LOCAL],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    url = None
    deadline = time.time() + 60
    assert p.stdout
    while time.time() < deadline and url is None:
        line = p.stdout.readline()
        m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line or "")
        if m:
            url = m.group(0)
    if not url:
        p.kill()
        raise RuntimeError("no tunnel url")
    threading.Thread(target=lambda: [None for _ in p.stdout], daemon=True).start()  # keep draining its log
    for _ in range(30):
        if healthy(url):
            return p, url
        time.sleep(2)
    p.kill()
    raise RuntimeError("tunnel never answered")


def publish(api: str):
    r = subprocess.run([str(PY), str(ROOT / "deploy/publish_pages.py"), "--live-only", "--api", api], cwd=ROOT)
    log("live.json ->", api or "(offline)", "ok" if r.returncode == 0 else "FAILED")


def main():
    server = None if healthy(LOCAL, 2) else start_server()
    tunnel, url = start_tunnel()
    publish(url)
    log("live at", url)
    misses = 0
    try:
        while True:
            time.sleep(30)
            if not healthy(LOCAL, 5):
                log("server down")
                if server:
                    server.kill()
                server = start_server()
            if tunnel.poll() is not None or not healthy(url, 15):
                misses += 1
                log("tunnel miss", misses)
                if tunnel.poll() is not None or misses >= 3:
                    tunnel.kill()
                    tunnel, url = start_tunnel()
                    publish(url)
                    log("live at", url)
                    misses = 0
            else:
                misses = 0
    except KeyboardInterrupt:
        log("stopping")
        publish("")
        tunnel.kill()
        if server:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
