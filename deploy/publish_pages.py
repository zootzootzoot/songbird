"""Publish the web app + the shelf tapes to GitHub Pages (branch gh-pages).

  server\\.venv\\Scripts\\python.exe deploy\\publish_pages.py [--api https://x.trycloudflare.com] [--no-build] [--live-only]

The Pages site works on its own (the shelf plays from static files). Making new tapes needs the GPU server,
which the page finds through live.json; deploy/serve.py keeps that file pointing at the current tunnel.
"""
from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
TAPES = ROOT / "server" / "data" / "tapes"
SHELF = ROOT / "server" / "data" / "samples.json"
WT = ROOT / ".deploy" / "gh-pages"
BASE = "/songbird/"
SITE = "https://zootzootzoot.github.io/songbird/"


def sh(*args, cwd=ROOT, check=True, capture=False):
    return subprocess.run(list(args), cwd=cwd, check=check, text=True, capture_output=capture, shell=False)


def worktree():
    if (WT / ".git").exists():
        sh("git", "fetch", "-q", "origin", check=False)
        return
    WT.parent.mkdir(parents=True, exist_ok=True)
    has_remote = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "gh-pages", check=False, capture=True).returncode == 0
    if has_remote:
        sh("git", "worktree", "add", "-f", str(WT), "gh-pages")
    else:
        sh("git", "worktree", "add", "-f", "--detach", str(WT))
        sh("git", "checkout", "-q", "--orphan", "gh-pages", cwd=WT)
        sh("git", "rm", "-rfq", ".", cwd=WT, check=False)


def write_live(api: str | None):
    (WT / "live.json").write_text(json.dumps({"api": api or ""}))


def copy_tapes():
    ids = json.loads(SHELF.read_text()) if SHELF.exists() else []
    dest = WT / "tapes"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    summaries = []
    for tid in ids:
        src = TAPES / tid
        tape = json.loads((src / "tape.json").read_text())
        out = dest / tid
        out.mkdir()
        for f in src.iterdir():
            if (f.name.startswith(("photo-", "cut-", "move-", "clip-", "cast-")) and "-art" not in f.name) or f.name == "song.mp3":
                shutil.copy2(f, out / f.name)
        if (src / "takes").is_dir():  # the session sheet plays every take, the cut ones too
            (out / "takes").mkdir()
            for f in (src / "takes").glob("take-*.mp3"):
                shutil.copy2(f, out / "takes" / f.name)
        if tape.get("cover"):  # the png is ~3.5 MB; a high-quality jpeg is a tenth of that
            Image.open(src / "cover.png").convert("RGB").save(out / "cover.jpg", quality=88, optimize=True)
            tape["cover"] = f"/tapes/{tid}/cover.jpg"
        (out / "tape.json").write_text(json.dumps(tape))
        summaries.append({k: tape.get(k) for k in ("id", "catalog", "artist", "genre", "style", "title", "dedication", "cover", "duration", "palette")}
                         | {"photos": len(tape["photos"]), "name": tape.get("name")})
        share_page(tape)
    (dest / "shelf.json").write_text(json.dumps({"tapes": summaries}))
    return summaries


def share_page(tape: dict):
    """/t/<id>/index.html: link-preview tags for chat apps and X, then straight into the deck."""
    tid = tape["id"]
    e = lambda s: html.escape(s or "", quote=True)
    title = f"{tape['title']} · songbird"
    desc = f"a {tape.get('genre') or 'small'} single by {tape.get('artist') or 'the small days'}. {tape.get('liner', '')}"
    img = SITE.rstrip("/") + tape["cover"] if tape.get("cover") else SITE + f"tapes/{tid}/photo-0.jpg"
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>{e(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{e(img)}"><meta property="og:type" content="music.song">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}"><meta name="twitter:image" content="{e(img)}">
<meta http-equiv="refresh" content="0; url={BASE}?tape={tid}"><link rel="canonical" href="{SITE}?tape={tid}">
</head><body><a href="{BASE}?tape={tid}">{e(tape['title'])}</a></body></html>"""
    d = WT / "t" / tid
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(page, encoding="utf-8")


def push(msg: str):
    sh("git", "add", "-A", cwd=WT)
    if sh("git", "diff", "--cached", "--quiet", cwd=WT, check=False).returncode == 0:
        print("nothing changed")
        return
    sh("git", "commit", "-q", "-m", msg, cwd=WT)
    sh("git", "push", "-q", "origin", "HEAD:gh-pages", cwd=WT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=None)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--live-only", action="store_true")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    worktree()
    if a.live_only:
        write_live(a.api)
        if not a.no_push:
            push("Point the deck at the live server")
        return
    if not a.no_build:
        subprocess.run(f"npm run build -- --base={BASE}", cwd=WEB, check=True, shell=True)  # npm is npm.cmd on Windows
    for p in WT.iterdir():
        if p.name not in (".git",):
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    shutil.copytree(WEB / "dist", WT, dirs_exist_ok=True)
    shutil.copy2(WT / "index.html", WT / "404.html")  # deep links fall back to the app
    (WT / ".nojekyll").write_text("")
    shelf = copy_tapes()
    write_live(a.api)
    print(f"shelf: {len(shelf)} tapes")
    if not a.no_push:
        push("Publish songbird")


if __name__ == "__main__":
    main()
