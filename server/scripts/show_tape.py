import json, sys
from pathlib import Path
t = json.loads((Path(__file__).resolve().parents[1] / "data/tapes" / sys.argv[1] / "tape.json").read_text())
print(t["title"], "|", t["dedication"], "|", t["duration"], t["key"], t["bpm"])
for l in t["lines"]:
    print(f"  {l['kind'][0]} {l['photo']} {l['start']:6.2f}-{l['end']:6.2f} {l['text']}")
print("liner:", t["liner"]); print("note:", t.get("note")); print([c["model"] for c in t["credits"]])
print([p["hero"] for p in t["photos"]])
