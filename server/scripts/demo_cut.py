"""Cut the demo from footage of the real product (demo_film.py) and the voiceover (demo_vo.py).

  server\\.venv\\Scripts\\python.exe server\\scripts\\demo_cut.py        -> film/demo/songbird-demo.mp4

The voiceover drives the edit: each section lasts as long as its part of the script, and the control room's
speed-ramp stretches to fit. Picture is cut clip by clip (no audio); the sound is one continuous mix made in a single
pass (music beds and the real songs, ducked under the voice), so nothing drops out at a join. Subtitles are the
voiceover's own words, timed by Meta's MMS aligner; when a model is named in the room, a ring finds its lamp.
film/demo/cut.json says whose day it is and where things are in the footage.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird.render import EDGE, FFMPEG, _port  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FILM = ROOT / "film" / "demo"
TAPES = ROOT / "server" / "data" / "tapes"
CARDS = Path(__file__).with_name("demo_cards.html")
WORK = FILM / "cut"
OUT = FILM / "songbird-demo.mp4"
FPS = 30

# the rack in the control room at 1920x1080: eleven lamps, left to right, and the words that name each one
LAMPS = [("Muse Spark",), ("SAM",), ("Muse Wonder",), ("dresses",), ("Muse Image",), ("shot list",), ("band records",),
         ("Demucs",), ("Spark 1.2",), ("Voice Transcribe",), ("MMS",)]
RACK_X0, RACK_X1, RACK_Y0, RACK_Y1 = 24, 1896, 86, 132


def dur_of(p: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout)


# ---------------------------------------------------------------- overlays (HTML -> transparent PNG)

async def _shoot(specs: dict[str, dict]):
    port = _port()
    prof = tempfile.mkdtemp(prefix="sb-cards-")
    edge = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                             "--window-size=1920,1080", "--force-device-scale-factor=1", "--hide-scrollbars",
                             "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(80):
            try:
                target = next((p for p in httpx.get(f"http://127.0.0.1:{port}/json/list", timeout=1).json()
                               if p.get("type") == "page"), None)
                if target:
                    break
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.25)
        async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
            seq = 0

            async def call(method, **params):
                nonlocal seq
                seq += 1
                me = seq
                await ws.send(json.dumps({"id": me, "method": method, "params": params}))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("id") == me:
                        return msg.get("result", {})

            await call("Page.enable")
            await call("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=1, mobile=False)
            await call("Emulation.setDefaultBackgroundColorOverride", color={"r": 0, "g": 0, "b": 0, "a": 0})
            for name, spec in specs.items():
                await call("Page.navigate", url="about:blank")
                await call("Page.navigate", url=CARDS.as_uri() + "#" + quote(json.dumps(spec)))
                for _ in range(80):
                    r = await call("Runtime.evaluate", expression="document.body && document.body.dataset.ready === '1'",
                                   returnByValue=True)
                    if r.get("result", {}).get("value"):
                        break
                    await asyncio.sleep(0.1)
                await asyncio.sleep(0.12)
                shot = await call("Page.captureScreenshot", format="png")
                (WORK / f"{name}.png").write_bytes(base64.b64decode(shot["data"]))
    finally:
        edge.kill()


# ---------------------------------------------------------------- the voiceover

VO = json.loads((FILM / "vo.json").read_text(encoding="utf-8"))["parts"]


def vo_len(n: int) -> float:
    return VO[n - 1]["end"] - VO[n - 1]["start"]


def _rel(n: int, t: float) -> float:
    return t - VO[n - 1]["start"]


def sentences(n: int) -> list[dict]:
    """part n's sentences with their spoken times, relative to the part's start"""
    out, cur = [], []
    for w in VO[n - 1]["words"]:
        cur.append(w)
        if re.search(r"[.!?][\"”]?$", w["w"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"text": " ".join(w["w"] for w in s), "start": _rel(n, s[0]["start"]), "end": _rel(n, s[-1]["end"])} for s in out]


def spoken(n: int, phrase: str) -> float | None:
    """when, within part n, the phrase starts (first match)"""
    p = VO[n - 1]
    norm = lambda s: re.sub(r"[^a-z0-9.]", "", s.lower()).rstrip(".")
    ws = [norm(w["w"]) for w in p["words"]]
    want = [norm(x) for x in phrase.split()]
    for i in range(len(ws) - len(want) + 1):
        if ws[i:i + len(want)] == want:
            return _rel(n, p["words"][i]["start"])
    return None


def subtitle_lines(n: int, at: float) -> list[tuple[str, float, float]]:
    """part n, said at timeline second `at`, as subtitle lines of up to ~44 characters, broken at punctuation"""
    p = VO[n - 1]
    lines, cur = [], []
    for w in p["words"]:
        cur.append(w)
        text = " ".join(x["w"] for x in cur)
        if len(text) >= 44 or (re.search(r"[.,;:!?][\"”]?$", w["w"]) and len(text) >= 20):
            lines.append(cur)
            cur = []
    if cur:
        if lines and len(" ".join(x["w"] for x in cur)) < 12:
            lines[-1] += cur
        else:
            lines.append(cur)
    out = []
    for k, ln in enumerate(lines):
        t0 = at + _rel(n, ln[0]["start"]) - 0.08
        end = at + _rel(n, ln[-1]["end"]) + 0.5
        if k + 1 < len(lines):
            end = min(end, at + _rel(n, lines[k + 1][0]["start"]) - 0.08)
        out.append((" ".join(x["w"] for x in ln), t0, end))
    return out


# ---------------------------------------------------------------- the timeline

class Timeline:
    def __init__(self):
        self.clips: list[dict] = []
        self.t = 0.0
        self.overlays: list[tuple[str, float, float]] = []
        self.music: list[dict] = []
        self.voice: list[tuple[int, float]] = []

    def clip(self, src, ss, dur, speed=1.0, crop=None, clock=None, fix=None):
        """clock: the footage second that the studio clock reads 0:00 at (shown over sped-up live footage)"""
        self.clips.append({"src": str(src), "ss": ss, "dur": dur, "speed": speed, "crop": crop, "at": self.t, "clock": clock,
                           "fix": fix})
        self.t += dur

    def still(self, color, dur):
        self.clips.append({"color": color, "dur": dur, "at": self.t})
        self.t += dur

    def over(self, png, t0, t1):
        self.overlays.append((png, t0, t1))

    def song(self, file, ss, at, dur, vol=1.0, fin=0.0, fout=0.0):
        self.music.append({"file": str(file), "ss": max(0.0, ss), "at": at, "dur": dur, "vol": vol, "fin": fin, "fout": fout})

    def say(self, n, at):
        self.voice.append((n, at))


def render_clip(k: int, c: dict, overlays) -> Path:
    out = WORK / f"v{k:02d}.mp4"
    args = [FFMPEG, "-y", "-loglevel", "error"]
    if "color" in c:
        args += ["-f", "lavfi", "-t", f"{c['dur']:.3f}", "-i", f"color=c={c['color']}:s=1920x1080:r={FPS}"]
    else:
        args += ["-ss", f"{c['ss']:.3f}", "-t", f"{c['dur'] * c['speed'] + 0.3:.3f}", "-i", c["src"]]
    mine = [(p, max(0.0, t0 - c["at"]), min(c["dur"], t1 - c["at"])) for p, t0, t1 in overlays
            if t1 > c["at"] + 0.01 and t0 < c["at"] + c["dur"] - 0.01]
    for p, *_ in mine:
        args += ["-loop", "1", "-t", f"{c['dur']:.3f}", "-i", str(WORK / f"{p}.png")]
    f = []
    chain = "null" if "color" in c else f"setpts=(PTS-STARTPTS)/{c['speed']:.5f}"
    if c.get("fix"):  # a filter for this clip alone (painting out a stray cursor)
        chain += "," + c["fix"]
    if c.get("crop"):
        x, y, w, h = c["crop"]
        chain += f",crop={w}:{h}:{x}:{y},scale=1920:1080:flags=lanczos"
    f.append(f"[0:v]{chain},fps={FPS},format=yuv420p[b]")
    v = "[b]"
    for i, (p, t0, t1) in enumerate(mine):
        d = 0.16
        fi = [f"fade=t=in:st={t0:.3f}:d={d}:alpha=1" if t0 > 0.01 else "null"]
        if t1 < c["dur"] - 0.01:
            fi.append(f"fade=t=out:st={max(t0, t1 - d):.3f}:d={d}:alpha=1")
        f.append(f"[{i + 1}:v]format=rgba,{','.join(fi)}[o{i}]")
        f.append(f"{v}[o{i}]overlay=0:0:shortest=1[v{i}]")
        v = f"[v{i}]"
    if c.get("clock") is not None:  # honest about the edit: how fast this live footage is playing
        font = r"fontfile='C\:/Windows/Fonts/CascadiaMono.ttf'"
        sp = "REAL SPEED" if abs(c["speed"] - 1) < 0.06 else f"▶▶ {c['speed']:.1f}× SPEED"
        f.append(f"{v}drawtext={font}:text='{sp}':fontsize=22:fontcolor=0xffc65a:x=1920-150-125-tw/2:y=43-th/2[ck]")
        v = "[ck]"
    args += ["-filter_complex", ";".join(f), "-map", v, "-t", f"{c['dur']:.3f}", "-an", "-c:v", "libx264",
             "-preset", "medium", "-crf", "17", "-r", str(FPS), "-pix_fmt", "yuv420p", str(out)]
    subprocess.run(args, check=True)
    return out


def mix(tl: Timeline, total: float) -> Path:
    """every piece of music and every voice part on one timeline, in one pass: no seams"""
    out = WORK / "mix.wav"
    args = [FFMPEG, "-y", "-loglevel", "error"]
    f = []
    for i, m in enumerate(tl.music):
        args += ["-i", m["file"]]
        ch = (f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start={m['ss']:.3f}:duration={m['dur']:.3f},"
              f"asetpts=PTS-STARTPTS,volume={m['vol']}")
        if m["fin"]:
            ch += f",afade=t=in:d={m['fin']}"
        if m["fout"]:
            ch += f",afade=t=out:st={max(0.0, m['dur'] - m['fout']):.3f}:d={m['fout']}"
        ms = int(round(m["at"] * 1000))
        f.append(ch + f",adelay={ms}|{ms}[m{i}]")
    nm = len(tl.music)
    args += ["-i", str(FILM / "vo.wav")]
    for k, (n, at) in enumerate(tl.voice):
        p = VO[n - 1]
        ms = int(round((at - 0.05) * 1000))
        f.append(f"[{nm}:a]atrim=start={p['start'] - 0.05:.3f}:end={p['end'] + 0.3:.3f},asetpts=PTS-STARTPTS,"
                 f"aformat=channel_layouts=stereo,afade=t=in:d=0.04,afade=t=out:st={vo_len(n) + 0.2:.3f}:d=0.15,adelay={ms}|{ms}[s{k}]")
    f.append("".join(f"[m{i}]" for i in range(nm)) + f"amix=inputs={nm}:normalize=0:duration=longest,apad=whole_dur={total:.3f}[music]")
    f.append("".join(f"[s{k}]" for k in range(len(tl.voice))) +
             f"amix=inputs={len(tl.voice)}:normalize=0:duration=longest,apad=whole_dur={total:.3f},asplit=2[vo][key]")
    f.append("[music][key]sidechaincompress=threshold=0.015:ratio=7:attack=30:release=500[duck]")
    f.append(f"[duck][vo]amix=inputs=2:normalize=0:duration=first,atrim=duration={total:.3f},"
             "loudnorm=I=-15:TP=-1.2:LRA=9[out]")
    args += ["-filter_complex", ";".join(f), "-map", "[out]", "-ar", "48000", "-ac", "2", str(out)]
    subprocess.run(args, check=True)
    return out


def first_sound(f: Path) -> float:
    """where the music actually starts (takes open with a little silence)"""
    r = subprocess.run([FFMPEG, "-hide_banner", "-t", "20", "-i", str(f), "-af", "silencedetect=n=-40dB:d=0.1", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"silence_start: ([\d.]+).*?silence_end: ([\d.]+)", r.stderr, re.S)
    return float(m.group(2)) if m and float(m.group(1)) < 0.05 else 0.0


def song_at(name: str, clip_t: float) -> float:
    m = json.loads((FILM / f"{name}.json").read_text())
    sb = m["sb"]
    return float(sb.get("from") or 0.0) + (clip_t - (sb["start"] / 1000.0 - m["t0"]))


def cap(tag, text="", tone="", pos=""):
    return {"kind": "cap", "tag": tag, "text": text, "tone": tone, "pos": pos}


# ---------------------------------------------------------------- the film

def main():
    cfg = json.loads((FILM / "cut.json").read_text(encoding="utf-8"))
    hero_tid = cfg["hero"]
    WORK.mkdir(parents=True, exist_ok=True)
    for old in WORK.glob("*"):
        old.unlink()
    who, day, genre = cfg["who"], cfg["day"], cfg["genre"]
    live = FILM / cfg["live"]
    marks = json.loads((FILM / cfg["live"].replace(".mp4", ".json")).read_text())["marks"]
    hero_song = TAPES / hero_tid / "song.mp3"
    tape = json.loads((TAPES / hero_tid / "tape.json").read_text(encoding="utf-8"))
    kept_take = next((i for i, t in enumerate(tape.get("takes") or []) if t.get("kept")), 0)
    bed = TAPES / hero_tid / "takes" / f"take-{cfg.get('bed_take', kept_take)}.mp3"  # never a take the tuner cut
    tl = Timeline()
    specs: dict[str, dict] = {}

    # 0 · cold open: the chorus of the single this film is about to make, sound up
    cold = cfg["cold_clip"]
    d0 = cfg.get("cold_len", 7.5)
    specs["a1"] = cap(f"{cfg['catalog']} · {who.upper()}'S DAY", f"{day}, as a <b>{genre}</b>.")
    tl.clip(FILM / f"{cold}.mp4", 0.5, d0)
    tl.over("a1", 0.6, d0 - 0.35)
    tl.song(hero_song, song_at(cold, 0.5), 0.0, d0, vol=1.0, fout=0.7)

    # 1 · the problem: the front door's sky, then the black "why songs" band
    front = FILM / "front.mp4"
    t1 = tl.t
    d1 = vo_len(1) + 1.3
    s1 = sentences(1)
    third = s1[2]["start"] + 0.5 if len(s1) > 2 else d1 * 0.6
    tl.clip(front, 0.0, third - 0.15)
    tl.clip(front, 14.2, d1 - (third - 0.15))
    specs["b1"] = {"kind": "card", "tone": "day", "text": "two trillion photos a year.<br><span class='soft'>almost none looked at again.</span>",
                   "src": "petapixel, 2025"}
    specs["b4"] = {"kind": "card", "tone": "night", "text": "but you still know every word<br>of a song you loved at fifteen.",
                   "src": "memories cued by music are rated more vivid than those cued by faces · belfi, karlan & tranel, memory, 2016"}
    tl.over("b1", t1 + 0.4 + s1[0]["start"], t1 + 0.5 + s1[0]["end"] + 0.35)
    if len(s1) > 2:
        tl.over("b4", t1 + third - 0.15, t1 + d1)
    tl.say(1, t1 + 0.5)

    # 2 · the product: the front door, a pill on one of the floating things
    t2 = tl.t
    d2 = vo_len(2) + 1.2
    tl.clip(front, 4.0, d2)
    tl.say(2, t2 + 0.35)

    # 3 · the day: the desk (zoomed), borrow, produce, then dusk
    t3 = tl.t
    desk0, prod = marks["desk"], marks["produce"]
    d3 = vo_len(3) + 0.8
    span = prod + 0.35 - desk0
    sp = max(0.55, min(1.6, span / d3))
    tl.clip(live, desk0, d3, speed=sp, crop=tuple(cfg["desk_crop"]))
    tl.say(3, t3 + 0.25)
    dusk = desk0 + d3 * sp
    t_dusk = tl.t
    cur = cfg.get("dusk_cursor")  # the stand-in cursor lingers on the button while the sky comes down
    tl.clip(live, dusk, 2.0, clock=prod, fix=f"delogo=x={cur[0] - 20}:y={cur[1] - 20}:w=40:h=40" if cur else None)

    # 4 + 5 · the control room, speed-ramped onto the voice
    room0 = dusk + 2.0
    g, cov, kept = marks["genre"], marks["cover"], marks["kept"]
    t4 = tl.t
    a_len = vo_len(4) + 0.9
    slow_a = [(room0, room0 + 3.0), (g - 0.2, g + 3.6)]
    fast_a = (room0 + 3.0, g - 0.2)
    out_a = max(1.5, a_len - sum(e - s for s, e in slow_a))
    tl.clip(live, slow_a[0][0], slow_a[0][1] - slow_a[0][0], clock=prod)
    tl.clip(live, fast_a[0], out_a, speed=(fast_a[1] - fast_a[0]) / out_a, clock=prod)
    tl.clip(live, slow_a[1][0], slow_a[1][1] - slow_a[1][0], clock=prod)
    tl.say(4, t4 + 0.35)
    t5 = tl.t
    b_len = vo_len(5) + 0.9
    slow_b = [(cov - 0.4, cov + 2.2), (kept - 1.4, kept + 1.0)]
    f1, f2 = (g + 3.6, cov - 0.4), (cov + 2.2, kept - 1.4)
    out_b = max(2.0, b_len - sum(e - s for s, e in slow_b))
    share = max(0.2, (f1[1] - f1[0]) / ((f1[1] - f1[0]) + (f2[1] - f2[0])))
    o1, o2 = out_b * share, out_b * (1 - share)
    tl.clip(live, f1[0], o1, speed=(f1[1] - f1[0]) / o1, clock=prod)
    tl.clip(live, slow_b[0][0], slow_b[0][1] - slow_b[0][0], clock=prod)
    tl.clip(live, f2[0], o2, speed=(f2[1] - f2[0]) / o2, clock=prod)
    tl.clip(live, slow_b[1][0], slow_b[1][1] - slow_b[1][0], clock=prod)
    specs["clock"] = {"kind": "clock"}
    tl.over("clock", t_dusk + 0.3, tl.t)
    tl.say(5, t5 + 0.35)
    for n, t_part in ((4, t4 + 0.35), (5, t5 + 0.35)):  # a ring finds each lamp as it is named
        for k, (phrase,) in enumerate(LAMPS):
            at = spoken(n, phrase)
            if at is None:
                continue
            name = f"ring{k}"
            specs[name] = {"kind": "ring", "x": RACK_X0 + (RACK_X1 - RACK_X0) * k / 11, "w": (RACK_X1 - RACK_X0) / 11,
                           "y": RACK_Y0, "h": RACK_Y1 - RACK_Y0}
            tl.over(name, t_part + at - 0.1, t_part + at + 1.6)
    # under 1-5: one of this release's own session takes, from its first note, crossfading out of the cold open
    tl.song(bed, first_sound(bed), t1 - 0.7, tl.t - t1 + 0.7, vol=0.6, fin=0.7, fout=0.9)

    # 6 · the result: the music video from its cold open, sound up
    t6 = tl.t
    hero = cfg["hero_clip"]
    d6 = cfg.get("result_len", 30.0)
    tl.clip(FILM / f"{hero}.mp4", 0.5, d6)
    tl.say(6, t6 + 0.5)
    took = marks["video"] - prod  # measured on the live footage: produce pressed -> the video is on screen
    release_time = cfg.get("release_time") or f"{int(took // 60)} MIN {int(took % 60):02d} S"
    specs["e1"] = cap(f"{cfg['catalog']} · {release_time} LATER", f"{day}, as a <b>{genre}</b>. with its own music video.")
    tl.over("e1", t6 + 0.3, t6 + 5.4)
    tl.song(hero_song, song_at(hero, 0.5), t6, d6 + 0.4, vol=1.0, fout=1.0)

    # 7 · how it works
    t7 = tl.t
    d7 = vo_len(7) + 1.4
    how = FILM / "how.mp4"
    tl.clip(how, 0.0, d7, speed=(dur_of(how) - 0.2) / d7)
    tl.say(7, t7 + 0.5)
    tl.song(hero_song, song_at(hero, 0.5) + d6 + 0.4, t7, d7, vol=0.55, fin=0.5, fout=0.9)

    # the 9:16 MP4 of this single, at its chorus, standing in the frame (the MP4 starts at the song's cold open)
    share_mp4 = TAPES / hero_tid / "share.mp4"
    share_from = dur_of(hero_song) + 3.0 - dur_of(share_mp4)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{cfg['share_song_at'] - share_from:.3f}", "-t", "12", "-i", str(share_mp4),
                    "-f", "lavfi", "-t", "12", "-i", f"color=c=0x0b0b0d:s=1920x1080:r={FPS}",
                    "-filter_complex", "[0:v]scale=-2:1000:flags=lanczos,format=yuv420p[p];[1:v][p]overlay=x=300:y=40:shortest=1,format=yuv420p[v]",
                    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", str(FPS), str(FILM / "share_g.mp4")], check=True)

    # 8 · every day has a genre: two more days, the 9:16 file, the discography
    t8 = tl.t
    d8 = vo_len(8) + 1.2
    s8 = sentences(8)
    b2 = s8[2]["start"] + 0.5 if len(s8) > 2 else d8 * 0.3
    b3 = (spoken(8, "Save") or d8 * 0.55) + 0.5
    b4 = (spoken(8, "and it stays") or d8 * 0.78) + 0.5
    (n_a, tid_a, tag_a, txt_a), (n_b, tid_b, tag_b, txt_b) = cfg["every_day"]
    tl.clip(FILM / f"{n_a}.mp4", 0.7, b2)
    specs["f_a"] = cap(tag_a, txt_a)
    tl.over("f_a", t8 + 0.15, t8 + b2 - 0.1)
    tl.song(TAPES / tid_a / "song.mp3", song_at(n_a, 0.7), t8, b2, vol=0.85, fin=0.08, fout=0.15)
    tl.clip(FILM / f"{n_b}.mp4", 0.7, b3 - b2)
    specs["f_b"] = cap(tag_b, txt_b)
    tl.over("f_b", t8 + b2 + 0.1, t8 + b3 - 0.1)
    tl.song(TAPES / tid_b / "song.mp3", song_at(n_b, 0.7), t8 + b2, b3 - b2, vol=0.85, fin=0.05, fout=0.15)
    tl.clip(FILM / "share_g.mp4", 0.0, b4 - b3)
    specs["g1"] = cap("SAVE THE VIDEO", "1080×1920, with the song,<br>for reels, stories, the group chat", pos="right mid wide")
    tl.over("g1", t8 + b3 + 0.1, t8 + b4 - 0.05)
    tl.song(hero_song, cfg["share_song_at"], t8 + b3, d8 - b3 + 0.3, vol=0.8, fin=0.05, fout=0.35)  # on under the discography
    shown = json.loads((FILM / "journal.json").read_text())["marks"]["shown"]  # the discography, already in view
    tl.clip(FILM / "journal.mp4", max(0.0, shown - 0.3), d8 - b4)
    tl.say(8, t8 + 0.5)

    # 9 · the close
    t9 = tl.t
    d9 = vo_len(9) + 3.8
    specs["h1"] = {"kind": "end", "text": "every day has a genre.", "url": "zootzootzoot.github.io/songbird", "sign": "your days, on record.",
                   "stats": [["10<small>/11</small>", "jobs done by eight meta models, from the first look to the last word"],
                             ["3", "models on open weights, on our own gpu: demucs, mms, ace-step"],
                             ["80–90%", "of the singing in the band's key, up from 64% once demucs found the bug"],
                             ["79–100%", "of lyric lines land on the sung beat with meta's mms aligner, up from 38–81%"],
                             ["4 takes", "per song: the off-key ones cut, the best one kept by spark 1.2's ear"],
                             ["~3 min", "from five photos to a single, its sleeve and a directed music video"]]}
    tl.still("0x0b0b0d", d9)
    tl.over("h1", t9, t9 + d9)
    tl.say(9, t9 + 0.4)
    tl.song(hero_song, cfg["close_song_at"], t9 - 0.35, d9 + 0.35, vol=0.7, fin=0.35, fout=2.8)

    # subtitles: the voice's own words, as spoken (MMS word times)
    k = 0
    for n, at in tl.voice:
        for text, s0, s1_ in subtitle_lines(n, at):
            specs[f"sub{k}"] = {"kind": "sub", "text": text}
            tl.over(f"sub{k}", s0, s1_)
            k += 1

    asyncio.run(_shoot(specs))
    print(f"{len(specs)} overlays, {len(tl.clips)} clips, timeline {tl.t:.1f} s", flush=True)
    vids = [render_clip(i, c, tl.overlays) for i, c in enumerate(tl.clips)]
    (WORK / "list.txt").write_text("\n".join(f"file '{v.as_posix()}'" for v in vids))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(WORK / "list.txt"),
                    "-c", "copy", str(WORK / "picture.mp4")], check=True)
    total = dur_of(WORK / "picture.mp4")
    audio = mix(tl, total)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(WORK / "picture.mp4"), "-i", str(audio),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest",
                    "-movflags", "+faststart", str(OUT)], check=True)
    (WORK / "timeline.json").write_text(json.dumps({"clips": tl.clips, "voice": tl.voice, "music": tl.music}, indent=1))
    print(f"{OUT} ({dur_of(OUT):.1f} s, {OUT.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
