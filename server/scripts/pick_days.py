"""Pick one release per sample day for the shelf: every attempt in data/released.txt, best kept-take score first,
but never two days in the same style unless nothing else is left. Rewrites released.txt so the pick is last per slug,
then run shelf_days.py.  usage: pick_days.py [--dry]"""
import json, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rel = root / "data" / "released.txt"
attempts: dict[str, list[dict]] = {}
for line in rel.read_text().splitlines():
    if not line.strip():
        continue
    slug, tid = line.split()
    f = root / "data" / "tapes" / tid / "tape.json"
    if not f.exists():
        continue
    t = json.loads(f.read_text(encoding="utf-8"))
    kept = next((k for k in t.get("takes", []) if k.get("kept")), {})
    attempts.setdefault(slug, []).append({"tid": tid, "style": t.get("style"), "genre": t.get("genre"),
                                          "score": kept.get("score") or 0, "g": kept.get("genre") or 0})

used: set[str] = set()
pick: dict[str, dict] = {}
# strongest days choose first, so a weak day gives way on style
order = sorted(attempts, key=lambda s: -max(a["score"] for a in attempts[s]))
for slug in order:
    opts = sorted(attempts[slug], key=lambda a: -a["score"])
    fresh = [a for a in opts if a["style"] not in used]
    best = fresh[0] if fresh and fresh[0]["score"] >= opts[0]["score"] - 1.5 else opts[0]
    pick[slug] = best
    used.add(best["style"])

for slug in sorted(pick):
    a = pick[slug]
    others = ", ".join(f'{x["style"]} {x["score"]}' for x in attempts[slug] if x is not a)
    print(f'{slug:14} {a["tid"]} {a["style"]:12} {a["score"]:5}  {a["genre"]}   (also: {others})')
if "--dry" not in sys.argv:
    with rel.open("a") as f:
        for slug, a in pick.items():
            f.write(f"{slug} {a['tid']}\n")
