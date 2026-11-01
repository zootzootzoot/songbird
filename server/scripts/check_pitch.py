"""Measure how closely a tape's sung vocal follows its score: median f0 over each note's middle half."""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
d = Path(sys.argv[1])
y, sr = sf.read(d / "vocal.wav")
score = json.loads((d / "score.json").read_text())
def f0(seg):
    est = []
    for k in range(0, len(seg) - 2048, 512):
        w = seg[k:k + 2048] * np.hanning(2048)
        ac = np.correlate(w, w, 'full')[2047:]
        lo, hi = int(sr / 900), int(sr / 120)
        lag = lo + np.argmax(ac[lo:hi])
        if ac[lag] > 0.3 * ac[0]: est.append(sr / lag)
    return np.median(est) if est else None
errs, silent = [], 0
for s in score["segments"]:
    t = s["offset"]
    durs = [float(x) for x in s["duration"].split()]; ps = [int(x) for x in s["note_pitch"].split()]
    row = []
    for dd, p in zip(durs, ps):
        if p:
            a, b = int((t + .25 * dd) * sr), int((t + .75 * dd) * sr)
            f = f0(y[a:b]) if b - a >= 2048 else None
            if f: e = 69 + 12 * np.log2(f / 440) - p; errs.append(e); row.append(f"{e:+.1f}")
            else: silent += 1; row.append("--")
        t += dd
    print(" ".join(row))
e = np.array(errs)
print(f"notes {len(e)} unmeasured {silent}  median {np.median(e):+.2f} st  |err|<0.5: {np.mean(np.abs(e)<.5)*100:.0f}%  <1: {np.mean(np.abs(e)<1)*100:.0f}%")
