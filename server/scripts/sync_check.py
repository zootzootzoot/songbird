"""How well do a tape's word times sit on the actual singing? For each word: is the isolated vocal sounding in the
150 ms after its start, and was it quiet just before a line's first word? Compares tape.heard.json with tape.json.
  python scripts/sync_check.py [tid ...]"""
import json, sys
from pathlib import Path
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parents[1]
tids = sys.argv[1:] or json.loads((root / "data" / "samples.json").read_text())


def score(lines, rms, hop, thr):
    on = lambda t: rms[int(t / hop):int((t + 0.15) / hop) + 1].max(initial=0) > thr
    words = [w for ln in lines for w in ln["words"]]
    voiced = np.mean([on(w["start"]) for w in words])
    # onset: the line's first word should begin near a rise in the vocal (quiet 300 ms before)
    rises = []
    for ln in lines:
        if not ln["words"]:
            continue
        t = ln["words"][0]["start"]
        before = rms[max(0, int((t - 0.3) / hop)):max(1, int((t - 0.05) / hop))]
        rises.append(on(t) and (before.mean() if len(before) else 0) < rms[int(t / hop):int((t + 0.3) / hop) + 1].mean())
    return voiced, float(np.mean(rises)) if rises else 0.0


for tid in tids:
    d = root / "data" / "tapes" / tid
    if not (d / "tape.heard.json").exists():
        continue
    new = json.loads((d / "tape.json").read_text(encoding="utf-8"))
    old = json.loads((d / "tape.heard.json").read_text(encoding="utf-8"))
    k = next(i for i, t in enumerate(new["takes"]) if t.get("kept"))
    v, sr = sf.read(str(d / "takes" / f"vocal-{k}.wav"), dtype="float32")
    v = v.mean(1) if v.ndim > 1 else v
    hop = 0.02
    n = int(sr * hop)
    rms = np.sqrt(np.convolve(v ** 2, np.ones(n) / n, mode="same")[::n] + 1e-12)
    thr = max(0.012, 0.14 * np.percentile(rms, 95))
    a, b = score(old["lines"], rms, hop, thr), score(new["lines"], rms, hop, thr)
    print(f'{new.get("catalog")} {new.get("style"):12} voiced at word start: heard {a[0]:.0%} -> aligned {b[0]:.0%}   '
          f'line onsets: {a[1]:.0%} -> {b[1]:.0%}')
