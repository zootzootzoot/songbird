"""Re-paint a release's sleeve with the current prompt: repaint_cover.py <tid> [...]"""
import json, sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from PIL import Image
from songbird import config, pipeline

def one(tid):
    d = config.TAPES / tid
    tape, log = json.loads((d / "tape.json").read_text()), json.loads((d / "log.json").read_text())
    n = len(tape["photos"])
    order = list(range(n))
    look = {"photos": [{"hero": p["hero"]} for p in tape["photos"]]}
    cuts = {k: (p["cutout"], p["box"]) for k, p in enumerate(tape["photos"])}
    photos = [Image.open(d / f"photo-{k}.jpg") for k in range(n)]
    song = dict(log["song"]); song.setdefault("style", tape.get("style"))
    tape["cover"] = pipeline._cover(d, look, order, cuts, photos, song)
    (d / "tape.json").write_text(json.dumps(tape, indent=1))
    return tid, tape["genre"]

with ThreadPoolExecutor(6) as ex:
    for tid, g in ex.map(one, sys.argv[1:]):
        print(tid, g)
