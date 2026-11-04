"""Cut the 3-minute demo from the footage demo_film.py shot of the real product.

  server\\.venv\\Scripts\\python.exe server\\scripts\\demo_cut.py        -> film/demo/songbird-demo.mp4

Captions and cards are HTML (demo_cards.html, the product's own type), rendered to transparent PNGs in headless
Edge. Every clip's audio is the real song from the second its video shows (each clip's json says where playback
started); the room runs over one of the same release's own session takes.
"""
from __future__ import annotations

import asyncio
import base64
import json
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
HERO = "t_ca622b08"  # sol's rainy sunday, made live on camera (SB-0038)

# ---------------------------------------------------------------- captions and cards

def cap(tag, text, tone="", pos=""):
    return {"kind": "cap", "tag": tag, "text": text, "tone": tone, "pos": pos}


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
                url = CARDS.as_uri() + "#" + quote(json.dumps(spec))
                await call("Page.navigate", url="about:blank")
                await call("Page.navigate", url=url)
                for _ in range(80):
                    r = await call("Runtime.evaluate", expression="document.body && document.body.dataset.ready === '1'",
                                   returnByValue=True)
                    if r.get("result", {}).get("value"):
                        break
                    await asyncio.sleep(0.1)
                await asyncio.sleep(0.15)
                shot = await call("Page.captureScreenshot", format="png")
                (WORK / f"{name}.png").write_bytes(base64.b64decode(shot["data"]))
    finally:
        edge.kill()


# ---------------------------------------------------------------- segments

def clipmeta(name):
    m = json.loads((FILM / f"{name}.json").read_text())
    sb = m["sb"]
    return float(sb.get("from") or 0.0), sb["start"] / 1000.0 - m["t0"]  # song second at playback start, its offset


def song_at(tid, name, clip_t):
    """the song second playing at `clip_t` into a render clip"""
    frm, off = clipmeta(name)
    return frm + (clip_t - off)


def seg(n, src, ss, dur, speed=1.0, crop=None, caps=(), audio=None, vol=1.0, fin=0.0, fout=0.0, base=None):
    """one segment: `dur` seconds of output from `src` at `ss` (sped up by `speed`), with captions
    [(png, t0, t1)] and audio (file, start) faded in/out."""
    out = WORK / f"seg{n:02d}.mp4"
    args = [FFMPEG, "-y", "-loglevel", "error"]
    if base is None:
        args += ["-ss", f"{ss:.3f}", "-t", f"{dur * speed + 0.2:.3f}", "-i", str(src)]
    else:
        args += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", base]
    for png, *_ in caps:
        args += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(WORK / f"{png}.png")]
    extra = []
    if audio:
        afile, ass = audio
        args += ["-ss", f"{ass:.3f}", "-t", f"{dur + 0.1:.3f}", "-i", str(afile)]
    else:
        args += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    ai = 1 + len(caps)
    f = []
    v = "[0:v]"
    if base is None:
        chain = f"setpts=(PTS-STARTPTS)/{speed}"
        if crop:
            x, y, w, h = crop
            chain += f",crop={w}:{h}:{x}:{y},scale=1920:1080:flags=lanczos"
        f.append(f"{v}{chain},fps=30,format=yuv420p[b0]")
        v = "[b0]"
    for k, (png, t0, t1) in enumerate(caps):
        fi = 1 + k
        d = 0.22
        f.append(f"[{fi}:v]format=rgba,fade=t=in:st={t0:.2f}:d={d}:alpha=1,fade=t=out:st={max(t0, t1 - d):.2f}:d={d}:alpha=1[c{k}]")
        f.append(f"{v}[c{k}]overlay=0:0:shortest=1[v{k}]")
        v = f"[v{k}]"
    a = f"[{ai}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol}"
    if fin:
        a += f",afade=t=in:d={fin}"
    if fout:
        a += f",afade=t=out:st={max(0.0, dur - fout):.2f}:d={fout}"
    f.append(a + "[a]")
    f.extend(extra)
    args += ["-filter_complex", ";".join(f), "-map", v, "-map", "[a]", "-t", f"{dur:.3f}",
             "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", "30", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "256k", "-ar", "48000", str(out)]
    subprocess.run(args, check=True)
    return out


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    song = lambda tid: TAPES / tid / "song.mp3"
    take1 = TAPES / HERO / "takes" / "take-1.mp3"

    specs = {
        # A. cold open
        "a1": cap("SB-0036 · PRIYA'S DAY", "priya's first half marathon, as a <b>1981 heavy metal single</b>."),
        # B. the problem, over the front door
        "b1": {"kind": "card", "tone": "day", "text": "we take two trillion photos a year.<br><span class='soft'>we look back at almost none of them.</span>", "src": "petapixel, 2025"},
        "b2": cap("SONGBIRD", "a music journal. <b>every day you live becomes a single.</b>"),
        "b3": cap("THE SHELF", "nine days, nine genres. every one made by the pipeline yours goes through."),
        "b4": {"kind": "card", "tone": "night", "text": "but you still know every word<br>of a song you loved at fifteen.", "src": "memories cued by music are rated more vivid than those cued by faces · belfi, karlan & tranel, memory, 2016"},
        # C. the desk
        "c1": cap("THE DESK", "borrow a day: sol's rainy sunday. five photos, one line."),
        # D. the control room
        "d1": cap("MUSE SPARK 1.3 · LOOK", "one look at the whole day: what each photo is about, in the order it happened."),
        "d2": cap("SAM 3.1 · CUT", "cuts out the thing in each photo. these are the band."),
        "d3": cap("MUSE WONDER 1.0 · PRODUCE", "the producer auditions every channel, then makes the call."),
        "d4": cap("MUSE WONDER 1.0 · THE CALL", "the genre is a verdict, and it comes with a reason.", "vu"),
        "d5": cap("MUSE WONDER 1.0 · WRITE", "every verse line is about one of sol's photos."),
        "d6": cap("MUSE IMAGE 1.0 · SLEEVE", "paints the sleeve from sol's own things, while the band records."),
        "d7": cap("MUSE IMAGE + SAM · SPARK 1.3", "dresses the band for the genre and writes the video's shot list. four lamps at once."),
        "d8": cap("ACE-STEP 1.5 XL · DEMUCS", "four takes. demucs splits the singer from the band; any take under 75% in key is cut."),
        "d9": cap("SPARK 1.2 · VOICE TRANSCRIBE · MMS", "a&r keeps one take. voice transcribe checks every line was sung; mms times every word."),
        # E. the result
        "e1": cap("SB-0038 · THREE MINUTES LATER", "sol's rainy sunday, as a 1973 prog single. with its own music video."),
        "e2": cap("MMS FORCED ALIGNER · META", "every word lights the moment it's sung."),
        "e3": cap("MUSE SPARK 1.3 · DIRECT", "close-ups, duets, photo flashes: spark's shot list, line by line."),
        # F. range
        "f1": cap("SB-0026 · MAYA", "first day at the new job → <em>1987 arcade chiptune</em>"),
        "f2": cap("SB-0020 · JONAS", "night shift at the bakery → <em>1994 eurodance</em>"),
        "f3": cap("SB-0029 · DEV", "spilled coffee before the pitch → <em>1984 arena rock</em>"),
        "f4": cap("SB-0037 · KEMI", "her sister's wedding → <em>1956 sock-hop rockabilly</em>"),
        "f5": cap("SB-0030 · LENA", "first solo trip, lisbon → <em>1975 new york salsa</em>"),
        "f6": cap("SB-0018 · THEO", "moving day, four flights, no lift → <em>1987 power ballad</em>"),
        "f0": cap("", "every day has a genre.", pos="top"),
        # G. take it with you
        "g1": cap("SAVE THE VIDEO", "a 1080×1920 mp4 with the song,<br>for reels, stories or the group chat.", pos="right mid wide"),
        "g2": cap("YOUR DISCOGRAPHY", "every single you make is kept on your<br>device: one day, one song, a year of them.", pos="right mid wide"),
        # H. the close
        "h1": {"kind": "end", "text": "every day has a genre.", "url": "zootzootzoot.github.io/songbird", "sign": "your days, on record.",
               "stats": [["10<small>/11</small>", "jobs done by eight meta models, from the first look to the last word"],
                         ["3", "models on open weights, on our own gpu: demucs, mms, ace-step"],
                         ["80–90%", "of the singing in the band's key, up from 64% once demucs found the bug"],
                         ["79–100%", "of lyric lines land on the sung beat with meta's mms aligner, up from 38–81%"],
                         ["4 takes", "per song; the off-key ones cut, the best one kept by spark 1.2's ear"],
                         ["0", "real people's photos: muse image photographed every sample day"]]},
    }
    asyncio.run(_shoot(specs))
    print("cards rendered", flush=True)

    live = FILM / "live.mp4"
    front = FILM / "front.mp4"
    segs = []
    n = iter(range(100))

    # A. cold open: the chorus of priya's single, sound up
    a_name = "v_t_b7ca9d83_30"
    segs.append(seg(next(n), FILM / f"{a_name}.mp4", 0.5, 8.5, caps=[("a1", 0.6, 8.3)],
                    audio=(song("t_b7ca9d83"), song_at("t_b7ca9d83", a_name, 0.5)), vol=1.0, fout=0.35))
    # B + C + D run over take 2 of sol's session (the band's own intro, then the take as recorded)
    bed = 0.0
    segs.append(seg(next(n), front, 0.0, 20.0, caps=[("b1", 0.0, 4.3), ("b2", 4.5, 8.7), ("b3", 9.0, 13.9), ("b4", 14.2, 19.9)],
                    audio=(take1, bed), vol=0.7, fin=0.6))
    bed += 20.0
    segs.append(seg(next(n), live, 31.6, 4.6, crop=(360, 215, 1200, 675), caps=[("c1", 0.3, 4.4)], audio=(take1, bed), vol=0.7))
    bed += 4.6
    segs.append(seg(next(n), live, 36.2, 2.1, audio=(take1, bed), vol=0.7))
    bed += 2.1
    room = [  # (live start, live end, speed, caption)
        (38.3, 44.3, 1, "d1"), (44.3, 66.0, 4, "d2"), (66.0, 87.6, 4, "d3"), (87.6, 94.6, 1, "d4"), (94.6, 111.0, 5, "d5"),
        (111.0, 114.5, 1, "d6"), (114.5, 131.0, 5, "d7"), (131.0, 215.5, 8, "d8"), (215.5, 219.4, 1, "d9"),
    ]
    for k, (s0, s1, sp, c) in enumerate(room):
        d = (s1 - s0) / sp
        segs.append(seg(next(n), live, s0, d, speed=sp, caps=[(c, 0.15, d - 0.1)], audio=(take1, bed), vol=0.55,
                        fout=0.5 if k == len(room) - 1 else 0.0))
        bed += d

    # E. the result: sol's video from its cold open, sound up
    e_name = f"v_{HERO}"
    segs.append(seg(next(n), FILM / f"{e_name}.mp4", 0.5, 47.0, caps=[("e1", 0.3, 4.9), ("e2", 5.4, 10.6), ("e3", 21.5, 27.0)],
                    audio=(song(HERO), song_at(HERO, e_name, 0.5)), vol=1.0, fout=0.3))

    # F. range: six days, six genres
    mont = [("t_421fd82f", "v_t_421fd82f_20", "f1"), ("t_c1630f26", "v_t_c1630f26_28", "f2"), ("t_e9e0c8d5", "v_t_e9e0c8d5_30", "f3"),
            ("t_e1f50e27", "v_t_e1f50e27_16", "f4"), ("t_650febc7", "v_t_650febc7_40", "f5"), ("t_8439984e", "v_t_8439984e_59", "f6")]
    for k, (tid, name, c) in enumerate(mont):
        caps = [(c, 0.15, 3.9)] + ([("f0", 0.0, 4.0)] if k == 0 else [])
        segs.append(seg(next(n), FILM / f"{name}.mp4", 0.7, 4.0, caps=caps,
                        audio=(song(tid), song_at(tid, name, 0.7)), vol=0.95, fin=0.06, fout=0.12))

    # G. the 9:16 MP4 of sol's single, at its second chorus, sound up
    share = TAPES / HERO / "share.mp4"
    share_from = float(json.loads((FILM / f"{e_name}.json").read_text())["sb"]["from"])  # the MP4 starts at the cold open too
    g_song = 93.3
    g = WORK / "g_base.mp4"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{g_song - share_from:.3f}", "-t", "10.2", "-i", str(share),
                    "-f", "lavfi", "-t", "10.2", "-i", "color=c=0x0b0b0d:s=1920x1080:r=30",
                    "-filter_complex", "[0:v]scale=-2:1000:flags=lanczos,format=yuv420p[p];[1:v][p]overlay=x=260:y=40:shortest=1,format=yuv420p[v]",
                    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", "30", str(g)], check=True)
    segs.append(seg(next(n), g, 0.0, 10.0, caps=[("g1", 0.4, 5.6), ("g2", 5.8, 9.9)], audio=(song(HERO), g_song), vol=1.0))

    # H. the close
    segs.append(seg(next(n), None, 0, 13.0, base="color=c=0x0b0b0d:s=1920x1080:r=30", caps=[("h1", 0.0, 13.2)],
                    audio=(song(HERO), g_song + 10.0), vol=0.9, fout=3.5))

    lst = WORK / "list.txt"
    lst.write_text("\n".join(f"file '{s.as_posix()}'" for s in segs))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-c:v", "copy", "-af", "loudnorm=I=-15:TP=-1.2:LRA=11", "-c:a", "aac", "-b:a", "256k",
                    "-movflags", "+faststart", str(OUT)], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(OUT)],
                         capture_output=True, text=True).stdout.strip()
    print(f"{OUT} ({float(dur):.1f} s, {OUT.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
