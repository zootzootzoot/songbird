"""The voiceover: split the recording on its pauses into the script's parts, then time every word with Meta's MMS
forced aligner (the same one the product uses on sung vocals), for the demo's subtitles and model call-outs.

  server\\.venv\\Scripts\\python.exe server\\scripts\\demo_vo.py <recording> [--placeholder]

--placeholder first writes a stand-in recording with the Windows voice, only to test the cut's timing.
Output: film/demo/vo.wav (48 kHz, cleaned) and film/demo/vo.json ({"parts": [{"n", "start", "end", "text", "words"}]}).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILM = ROOT / "film" / "demo"
SCRIPT = ROOT / "docs" / "DEMO_SCRIPT.md"
FFMPEG = "ffmpeg"
ACE_PY = ROOT.parent / "rea-work" / "acestep" / ".venv" / "Scripts" / "python.exe"


def script_parts() -> list[str]:
    """the nine numbered parts of docs/DEMO_SCRIPT.md, as spoken text"""
    md = SCRIPT.read_text(encoding="utf-8").split("## If you pick someone else")[0]
    parts, cur = [], None
    for line in md.splitlines():
        if re.match(r"^\*\*\d+ · ", line):
            if cur is not None:
                parts.append(" ".join(cur))
            cur = []
        elif cur is not None and line.startswith(">"):
            cur.append(line.lstrip("> ").strip())
    if cur:
        parts.append(" ".join(cur))
    return [re.sub(r"\s+", " ", p).strip() for p in parts]


def placeholder(out: Path, parts: list[str]):
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f"$s.Rate = 1; $s.SetOutputToWaveFile('{out}'); $p = New-Object System.Speech.Synthesis.PromptBuilder; ")
    for p in parts:
        ps += f"$p.AppendText('{p.replace(chr(39), chr(39) * 2)}'); $p.AppendBreak([TimeSpan]::FromSeconds(2.2)); "
    ps += "$s.Speak($p); $s.Dispose()"
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)


def clean(src: Path, dst: Path):
    """48 kHz mono, rumble cut, gentle compression and levelled, so a phone recording sits well over music"""
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "48000", "-af",
                    "highpass=f=80,lowpass=f=12000,afftdn=nf=-30,acompressor=threshold=-20dB:ratio=3:attack=8:release=120,"
                    "loudnorm=I=-16:TP=-1.5:LRA=7", str(dst)], check=True)


def speech_spans(wav: Path, min_gap: float = 1.25) -> list[tuple[float, float]]:
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(wav), "-af", f"silencedetect=n=-38dB:d={min_gap}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                               capture_output=True, text=True).stdout)
    spans, t = [], 0.0
    for s, e in zip(starts, ends + [dur] * (len(starts) - len(ends))):
        if s - t > 0.3:
            spans.append((t, s))
        t = e
    if dur - t > 0.3:
        spans.append((t, dur))
    return spans


def fit(spans, n):
    """merge the closest neighbours until there are exactly n parts (a long breath inside a part splits it)"""
    spans = list(spans)
    while len(spans) > n:
        gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
        i = gaps.index(min(gaps))
        spans[i:i + 2] = [(spans[i][0], spans[i + 1][1])]
    if len(spans) < n:
        raise SystemExit(f"found {len(spans)} parts but the script has {n}: leave a two-second pause between parts")
    return spans


ALIGN = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
import fa
job = json.loads(open(sys.argv[2], encoding="utf-8").read())
out = []
for p in job:
    words = p["text"].split()
    r = fa.words(p["wav"], [words], device="cpu")[0]
    out.append([None if w is None else [w[0], w[1], w[2]] for w in (r or [None] * len(words))])
print(json.dumps(out))
'''


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    parts = script_parts()
    FILM.mkdir(parents=True, exist_ok=True)
    raw = Path(args[0]) if args else FILM / "vo_placeholder.wav"
    if "--placeholder" in sys.argv:
        placeholder(raw, parts)
    vo = FILM / "vo.wav"
    clean(raw, vo)
    spans = fit(speech_spans(vo), len(parts))
    work = FILM / "vo_parts"
    work.mkdir(exist_ok=True)
    job = []
    for k, ((s, e), text) in enumerate(zip(spans, parts)):
        w = work / f"part{k + 1}.wav"
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i", str(vo),
                        "-ac", "1", "-ar", "16000", str(w)], check=True)
        job.append({"wav": str(w), "text": text})
    jf = work / "job.json"
    jf.write_text(json.dumps(job), encoding="utf-8")
    r = subprocess.run([str(ACE_PY), "-c", ALIGN, str(ROOT / "server" / "songbird"), str(jf)],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])
    aligned = json.loads(r.stdout.strip().splitlines()[-1])
    out = []
    for k, ((s, e), text, al) in enumerate(zip(spans, parts, aligned)):
        ws = text.split()
        words = []
        for i, w in enumerate(ws):
            a = al[i] if i < len(al) else None
            if a is None:  # the aligner wasn't sure: spread it between its neighbours
                words.append({"w": w, "start": None, "end": None})
            else:
                words.append({"w": w, "start": round(s + a[0], 3), "end": round(s + a[1], 3)})
        for i, x in enumerate(words):  # fill gaps
            if x["start"] is None:
                prev = next((words[j]["end"] for j in range(i - 1, -1, -1) if words[j]["end"] is not None), s)
                nxt = next((words[j]["start"] for j in range(i + 1, len(words)) if words[j]["start"] is not None), e)
                x["start"], x["end"] = prev, nxt
        out.append({"n": k + 1, "start": round(s, 3), "end": round(e, 3), "text": text, "words": words})
        print(f"part {k + 1}: {s:6.2f}-{e:6.2f} ({e - s:4.1f} s) {text[:60]}")
    (FILM / "vo.json").write_text(json.dumps({"parts": out}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
