"""Film the real product for the demo video: a headless Edge at 1920x1080 driven over DevTools.

Each shot is a small script of real interactions (a visible cursor glides to an element, then real mouse events
hover or click it), filmed with the DevTools screencast and encoded at 60 fps. Named marks (wall-clock moments,
relative to the first frame) go next to the clip so the edit can cut on them.

  server\\.venv\\Scripts\\python.exe server\\scripts\\demo_film.py <shot> [...]      (shots: see SHOTS)

Output: film/demo/<shot>.mp4 + <shot>.json ({"marks": {...}, "length": s, "sb": {...}}).
"""
from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird.render import EDGE, FFMPEG, _port  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "film" / "demo"
SITE = "https://zootzootzoot.github.io/songbird/"
LOCAL = "http://127.0.0.1:8787/"
W, H = 1920, 1080

CURSOR = """
(() => {
  if (document.getElementById('sb-cursor')) return;
  const c = document.createElement('div');
  c.id = 'sb-cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;'
    + 'background:rgba(255,255,255,.92);box-shadow:0 2px 14px rgba(0,0,0,.35),0 0 0 1.5px rgba(12,20,36,.55);'
    + 'z-index:2147483647;pointer-events:none;transform:translate(960px,700px);opacity:0;'
    + 'transition:transform 650ms cubic-bezier(.2,.8,.2,1),opacity 250ms linear,scale 120ms ease';
  document.documentElement.appendChild(c);
})()
"""


class Shot:
    def __init__(self, ws, frames_dir: Path):
        self.ws = ws
        self.dir = frames_dir
        self.seq = 0
        self.pending: dict[int, asyncio.Future] = {}
        self.frames: list[tuple[float, str]] = []
        self.marks: dict[str, float] = {}
        self.cx, self.cy = W / 2, H * 0.65

    async def call(self, method, **params):
        self.seq += 1
        fut = asyncio.get_running_loop().create_future()
        self.pending[self.seq] = fut
        await self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params}))
        return await fut

    async def pump(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                self.pending.pop(msg["id"]).set_result(msg.get("result", {}))
            elif msg.get("method") == "Page.screencastFrame":
                p = msg["params"]
                name = f"f{len(self.frames):06d}.jpg"
                (self.dir / name).write_bytes(base64.b64decode(p["data"]))
                self.frames.append((p["metadata"]["timestamp"], name))
                await self.ws.send(json.dumps({"id": 0, "method": "Page.screencastFrameAck",
                                               "params": {"sessionId": p["sessionId"]}}))

    async def js(self, expr: str):
        r = await self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def mark(self, name: str):
        self.marks[name] = time.time()
        print(f"  mark {name}", flush=True)

    async def wait(self, s: float):
        await asyncio.sleep(s)

    async def until(self, expr: str, timeout: float = 300, every: float = 0.25) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            if await self.js(expr):
                return True
            await asyncio.sleep(every)
        return False

    async def rect(self, selector: str, text: str | None = None):
        q = json.dumps(selector)
        t = json.dumps(text)
        return await self.js(f"""(() => {{
          const els = [...document.querySelectorAll({q})].filter(e => {t} === null || (e.textContent||'').includes({t}));
          const e = els.find(e => {{ const r = e.getBoundingClientRect(); return r.width && r.height; }});
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return {{x: r.left + r.width/2, y: r.top + r.height/2, top: r.top, h: r.height}};
        }})()""")

    async def glide(self, x: float, y: float, dur: float = 0.65):
        await self.js(CURSOR)
        await self.js(f"(()=>{{const c=document.getElementById('sb-cursor');c.style.opacity=1;"
                      f"c.style.transitionDuration='{int(dur * 1000)}ms, 250ms, 120ms';"
                      f"c.style.transform='translate({x}px,{y}px)';}})()")
        steps = max(6, int(dur * 30))
        x0, y0 = self.cx, self.cy
        for i in range(1, steps + 1):  # real mouse moves along the way, so hovers fire as the cursor passes
            k = i / steps
            e = 1 - (1 - k) ** 3
            await self.call("Input.dispatchMouseEvent", type="mouseMoved", x=x0 + (x - x0) * e, y=y0 + (y - y0) * e)
            await asyncio.sleep(dur / steps)
        self.cx, self.cy = x, y

    async def hide_cursor(self):
        await self.js("(()=>{const c=document.getElementById('sb-cursor'); if(c) c.style.opacity=0;})()")

    async def click_at(self, x: float, y: float):
        await self.glide(x, y)
        await asyncio.sleep(0.18)
        await self.js("(()=>{const c=document.getElementById('sb-cursor'); if(c){c.style.scale='.8'; setTimeout(()=>c.style.scale='1',140);}})()")
        for t in ("mousePressed", "mouseReleased"):
            await self.call("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)

    async def click(self, selector: str, text: str | None = None) -> bool:
        r = await self.rect(selector, text)
        if not r:
            print(f"  no element {selector} {text or ''}", flush=True)
            return False
        await self.click_at(r["x"], r["y"])
        return True

    async def scroll_to(self, selector: str, offset: float = 0.0, dur: float = 1.6):
        """smooth scroll so the element's top sits `offset` px from the viewport top"""
        q = json.dumps(selector)
        await self.js(f"""(() => {{
          const e = document.querySelector({q}); if (!e) return;
          const goal = window.scrollY + e.getBoundingClientRect().top - {offset};
          const from = window.scrollY, t0 = performance.now(), d = {dur * 1000};
          const step = (now) => {{ const k = Math.min(1, (now - t0) / d), e2 = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
            window.scrollTo(0, from + (goal - from) * e2); if (k < 1) requestAnimationFrame(step); }};
          requestAnimationFrame(step);
        }})()""")
        await asyncio.sleep(dur + 0.1)


async def run(shot_name: str, url: str, script, limit: float = 420):
    OUT.mkdir(parents=True, exist_ok=True)
    port = _port()
    prof = tempfile.mkdtemp(prefix="sb-demo-")
    frames_dir = Path(tempfile.mkdtemp(prefix="sb-demo-frames-"))
    edge = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                             f"--window-size={W},{H}", "--force-device-scale-factor=1", "--hide-scrollbars",
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
        assert target, "browser didn't start"
        async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
            s = Shot(ws, frames_dir)
            pumper = asyncio.create_task(s.pump())
            await s.call("Page.enable")
            await s.call("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
            await s.call("Emulation.setFocusEmulationEnabled", enabled=True)
            await s.call("Page.navigate", url=url)
            await s.until("document.readyState === 'complete'", 30)
            await asyncio.sleep(1.2)  # fonts and first paint before the first frame
            await s.call("Page.startScreencast", format="jpeg", quality=90, maxWidth=W, maxHeight=H, everyNthFrame=1)
            s.mark("start")
            try:
                await asyncio.wait_for(script(s), timeout=limit)
            except asyncio.TimeoutError:
                print("  shot timed out; keeping what was filmed", flush=True)
            s.mark("end")
            await s.call("Page.stopScreencast")
            sb = await s.js("JSON.stringify(window.__sb || {})")
            pumper.cancel()
        frames = s.frames
        t0 = frames[0][0]
        end = s.marks["end"]
        lines = []
        for k, (t, n) in enumerate(frames):
            nxt = frames[k + 1][0] if k + 1 < len(frames) else end
            lines += [f"file '{(frames_dir / n).as_posix()}'", f"duration {max(0.001, nxt - t):.4f}"]
        lines.append(f"file '{(frames_dir / frames[-1][1]).as_posix()}'")
        (frames_dir / "list.txt").write_text("\n".join(lines))
        out = OUT / f"{shot_name}.mp4"
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(frames_dir / "list.txt"),
                        "-vf", f"scale={W}:{H}:flags=lanczos,fps=60,format=yuv420p", "-c:v", "libx264", "-preset", "medium",
                        "-crf", "16", "-t", f"{end - t0:.2f}", str(out)], check=True)
        meta = {"marks": {k: round(v - t0, 3) for k, v in s.marks.items()}, "length": round(end - t0, 3),
                "sb": json.loads(sb or "{}"), "t0": t0, "url": url}
        (OUT / f"{shot_name}.json").write_text(json.dumps(meta, indent=1))
        gaps = [b[0] - a[0] for a, b in zip(frames, frames[1:])]
        print(f"{shot_name}: {len(frames)} frames over {end - t0:.1f}s, longest gap {max(gaps):.2f}s -> {out}", flush=True)
    finally:
        edge.kill()
        shutil.rmtree(prof, ignore_errors=True)
        shutil.rmtree(frames_dir, ignore_errors=True)


# ---------------------------------------------------------------- the shots

async def front(s: Shot):
    """the front door: the sky, an object's pill, then down through the page"""
    await s.wait(4.0)
    s.mark("hover")
    r = await s.rect(".fl__thing")
    things = await s.js("[...document.querySelectorAll('.fl__thing')].map(e=>{const r=e.getBoundingClientRect();"
                        "return [r.left+r.width/2, r.top+r.height/2, e.getAttribute('aria-label')||'']})")
    # pick a thing on the right side, away from the wordmark
    pick = sorted([t for t in things if t[0] > W * 0.62 and 200 < t[1] < H - 160], key=lambda t: t[1])
    tx, ty, _ = (pick[0] if pick else (r["x"], r["y"], ""))
    await s.glide(tx, ty, 1.1)
    await s.wait(2.4)
    await s.glide(W * 0.5, H * 0.86, 0.9)
    await s.hide_cursor()
    s.mark("shelf")
    await s.scroll_to(".fr__shelf", 40, 2.2)
    await s.wait(3.0)
    s.mark("why")
    await s.scroll_to(".fr__manifesto", 0, 2.0)
    await s.wait(3.5)
    s.mark("how")
    await s.scroll_to(".fr__how", 30, 2.0)
    await s.wait(3.0)
    await s.scroll_to(".fr__chain", 120, 1.6)
    await s.wait(3.5)


def live_for(who: str | None):
    async def live(s: Shot):
        """the real journey: borrow `who`'s day, linger on it, produce, the room, into the video"""
        await s.until("!!document.querySelector('.fr__desk')", 30)
        await s.scroll_to(".fr__desk", 60, 0.01)
        await s.wait(0.8)
        name_js = "(document.querySelector('input[placeholder=\"your name\"]')||{}).value||''"
        for _ in range(16):
            await s.click("button", "borrow someone")
            await s.until("[...document.querySelectorAll('.fr__slot img')].length >= 3", 20)
            await s.wait(0.6)
            got = (await s.js(name_js) or "").strip().lower()
            print(f"  borrowed {got}", flush=True)
            if not who or got == who.lower():
                break
        s.mark("desk")
        # linger: the cursor drifts over the photos, then the note, then produce
        slots = await s.js("[...document.querySelectorAll('.fr__slot img')].map(e=>{const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})")
        for x, y in (slots or [])[:5]:
            await s.glide(x, y, 0.55)
            await s.wait(0.5)
        note = await s.rect(".fr__note-in, .fr__note input, .fr__desk textarea")
        if note:
            await s.glide(note["x"], note["y"], 0.6)
        await s.wait(2.0)
        s.mark("produce")
        await s.click("button", "produce my day")
        await s.hide_cursor()
        await s.until("!!document.querySelector('.room')", 30)
        s.mark("room")
        checks = {
            "seen": "!!document.querySelector('.rm-call[data-mode=audition]')",
            "genre": "!!document.querySelector('.rm-call[data-mode=call]')",
            "cover": "!!document.querySelector('.rm-sleeve')",
            "take1": "document.querySelectorAll('.rm-take:not([data-status=armed]):not([data-status=rec])').length >= 1",
            "kept": "!!document.querySelector('.rm-take[data-status=kept]')",
            "video": "!!document.querySelector('[data-surface=video]')",
        }
        t0 = time.time()
        while time.time() - t0 < 330 and "video" not in s.marks:  # every mark is checked on every tick, none blocks
            state = await s.js("({" + ",".join(f"{json.dumps(k)}: {v}" for k, v in checks.items()) + "})") or {}
            for k, v in state.items():
                if v and k not in s.marks:
                    s.mark(k)
            await asyncio.sleep(0.25)
        await s.wait(12)
    return live


def render_shot(tid: str, at: float | None, hold: float):
    async def script(s: Shot):
        await s.until("window.__sb && window.__sb.start", 40)
        s.mark("play")
        await s.wait(hold)
    q = f"?tape={tid}&render=1" + (f"&at={at}" if at else "")
    return q, script


async def how(s: Shot):
    await s.wait(21.0)


def journal_entries(hero: str | None = None) -> list[dict]:
    """a discography as the front door's journal keeps it: one release per day (the hero's own, else the best the A&R
    heard), the hero first, then newest first"""
    tapes = ROOT / "server" / "data" / "tapes"
    best: dict[str, tuple[float, dict]] = {}
    for d in tapes.iterdir():
        f = d / "tape.json"
        if not f.exists():
            continue
        t = json.loads(f.read_text(encoding="utf-8"))
        if not t.get("cover") or not t.get("catalog") or not t.get("name"):
            continue
        kept = next((k for k in t.get("takes") or [] if k.get("kept")), {})
        score = 99.0 if t["id"] == hero else float(kept.get("score") or 0)
        e = {"id": t["id"], "title": t["title"], "genre": t.get("genre"), "cover": t["cover"],
             "catalog": t["catalog"], "at": t["createdAt"]}
        day = t["name"].lower()
        if day not in best or score > best[day][0]:
            best[day] = (score, e)
    out = sorted((e for _, e in best.values()), key=lambda e: e["at"], reverse=True)
    out.sort(key=lambda e: e["id"] != hero)
    return out[:8]


JOURNAL_HERO: str | None = None


async def journal(s: Shot):
    entries = json.dumps(journal_entries(JOURNAL_HERO))
    await s.js(f"localStorage.setItem('songbird.journal.v1', JSON.stringify({entries})); location.reload(); 1")
    await s.wait(2.5)
    await s.until("!!document.querySelector('.fr__mine')", 20)
    await s.scroll_to(".fr__mine", 140, 0.01)
    await s.wait(1.2)
    s.mark("shown")
    await s.wait(8)


HOW = (Path(__file__).with_name("demo_how.html")).as_uri()
SHOTS = {"front": (SITE, front, 120), "live": (SITE, live_for(None), 420), "how": (HOW, how, 60), "journal": (LOCAL, journal, 60)}


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        if arg.startswith("render:"):  # render:<tid>[:<at>[:<hold>]] -> a clean landscape film of the video
            parts = arg.split(":")
            tid = parts[1]
            at = float(parts[2]) if len(parts) > 2 and parts[2] else None
            hold = float(parts[3]) if len(parts) > 3 else 20
            q, script = render_shot(tid, at, hold)
            name = f"v_{tid}" + (f"_{int(at)}" if at else "")
            asyncio.run(run(name, LOCAL + q, script, limit=hold + 90))
        elif arg.startswith("journal:"):  # journal:<tid> -> the discography, that release first
            JOURNAL_HERO = arg.split(":", 1)[1]
            asyncio.run(run("journal", LOCAL, journal, 60))
        elif arg.startswith("live:"):  # live:<name> -> borrow that person's day
            who = arg.split(":", 1)[1]
            asyncio.run(run(f"live_{who}", SITE, live_for(who), 480))
        else:
            url, script, limit = SHOTS[arg]
            asyncio.run(run(arg, url, script, limit))
