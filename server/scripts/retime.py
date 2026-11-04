"""Re-time released tapes' lyrics by forced alignment (songbird/fa.py). Run with the band's python:
  <acestep>/.venv/Scripts/python.exe scripts/retime.py [tid ...]     (no args = the shelf, data/samples.json)
Keeps the previous tape as tape.heard.json the first time."""
import json, shutil, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "songbird"))
import fa  # noqa: E402

tids = sys.argv[1:] or json.loads((root / "data" / "samples.json").read_text())
for tid in tids:
    d = root / "data" / "tapes" / tid
    src = d / "tape.heard.json"
    if not src.exists():
        shutil.copy2(d / "tape.json", src)
    tape = json.loads(src.read_text(encoding="utf-8"))  # always start from the heard times
    k = next(i for i, t in enumerate(tape["takes"]) if t.get("kept"))
    vocal = d / "takes" / f"vocal-{k}.wav"
    if not vocal.exists():
        print(tid, "no vocal stem, skipped")
        continue
    lines = fa.retime(tape["lines"], str(vocal))
    moved = [abs(a["start"] - b["start"]) for a, b in zip(tape["lines"], lines)]
    n = sum(ln["timing"] == "aligned" for ln in lines)
    tape["lines"] = lines
    (d / "tape.json").write_text(json.dumps(tape, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f'{tid} {tape.get("catalog")} {tape.get("style"):12} aligned {n}/{len(lines)} lines, '
          f'line starts moved median {sorted(moved)[len(moved) // 2]:.2f}s max {max(moved):.2f}s', flush=True)
