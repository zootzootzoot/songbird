"""Compare a release's current word times with forced alignment (songbird/fa.py). Run with the band's python:
  <acestep>/.venv/Scripts/python.exe scripts/fa_trial.py <tid>"""
import json, sys, time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "songbird"))
import fa  # noqa: E402

tid = sys.argv[1]
d = root / "data" / "tapes" / tid
tape = json.loads((d / "tape.json").read_text(encoding="utf-8"))
k = next(i for i, t in enumerate(tape["takes"]) if t.get("kept"))
lines = [[w["text"] for w in ln["words"]] or ln["text"].split() for ln in tape["lines"]]
t0 = time.time()
got = fa.words(str(d / "takes" / f"vocal-{k}.wav"), lines)
print(f"aligned {sum(len(x) for x in lines)} words in {time.time() - t0:.1f}s")
diffs = []
for ln, ws in zip(tape["lines"], got):
    old = [w["start"] for w in ln["words"]]
    new = [w[0] if w else None for w in ws]
    pairs = [(o, n) for o, n in zip(old, new) if n is not None]
    diffs += [abs(o - n) for o, n in pairs]
    sc = [w[2] for w in ws if w]
    print(f'{ln["text"][:42]:42} old {old[0] if old else 0:6.2f}  new {new[0] if new and new[0] is not None else -1:6.2f}'
          f'  score {sum(sc) / max(1, len(sc)):.2f}')
diffs.sort()
print(f"word start shift: median {diffs[len(diffs) // 2]:.2f}s, 90th {diffs[int(len(diffs) * 0.9)]:.2f}s, max {diffs[-1]:.2f}s")
