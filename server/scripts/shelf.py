"""Manage the demo shelf: finished tapes that play without the GPU.  shelf.py [add|rm] <tape id> | list"""
import json, sys
from pathlib import Path
DATA = Path(__file__).resolve().parents[1] / "data"
f = DATA / "samples.json"
ids = json.loads(f.read_text()) if f.exists() else []
cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
if cmd == "add":
    for t in sys.argv[2:]:
        assert (DATA / "tapes" / t / "tape.json").exists(), f"{t} is not finished"
        if t not in ids: ids.append(t)
elif cmd == "rm":
    ids = [i for i in ids if i not in sys.argv[2:]]
f.write_text(json.dumps(ids, indent=1))
for t in ids:
    tape = json.loads((DATA / "tapes" / t / "tape.json").read_text())
    print(t, "|", tape["title"], "|", tape["dedication"], "|", round(tape["duration"]), "s")
