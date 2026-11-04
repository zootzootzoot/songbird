"""Put the released sample days on the shelf: data/released.txt ("slug tid", last one per slug wins) ->
data/samples.json (shelf order = DAYS order) and web/public/objects/objects.json (each object gets its day's tid)."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ORDER = ["first-day", "moving-day", "half-marathon", "bakery-nights", "rain-sunday", "the-wedding", "pitch-day",
         "lisbon-solo", "allotment"]
tids: dict[str, str] = {}
for line in (root / "data" / "released.txt").read_text().splitlines():
    if line.strip():
        slug, tid = line.split()
        tids[slug] = tid

shelf = [tids[s] for s in ORDER if s in tids]
(root / "data" / "samples.json").write_text(json.dumps(shelf, indent=1))
obj_path = root.parent / "web" / "public" / "objects" / "objects.json"
objects = json.loads(obj_path.read_text())
for o in objects:
    o.pop("tid", None)
    if o["day"] in tids:
        o["tid"] = tids[o["day"]]
obj_path.write_text(json.dumps(objects, indent=1))
print(f"shelf {len(shelf)}: {shelf}")
