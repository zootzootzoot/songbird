"""Cast a release's band as performers (cast.py): cast_trial.py <tid> [...]  -> data/cast_trial/<tid>/"""
import json, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402
from songbird import cast, config  # noqa: E402

def member(tid, tape, k, role):
    d, p, t = config.TAPES / tid, tape["photos"][k], time.time()
    cut = Image.open(d / f"cut-{k}.png") if p.get("cutout") else None
    r = cast.performer(Image.open(d / f"photo-{k}.jpg"), cut, p["hero"], role, tape["genre"], tape.get("style"))
    out = config.DATA / "cast_trial" / tid
    out.mkdir(parents=True, exist_ok=True)
    if r:
        r[0].save(out / f"cast-{k}.png"); r[1].save(out / f"art-{k}.png")
    return k, p["hero"], round(time.time() - t, 1), bool(r)

for tid in sys.argv[1:]:
    tape = json.loads((config.TAPES / tid / "tape.json").read_text())
    roles = {b["photo"]: b["role"] for b in tape["band"]}
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(lambda k: member(tid, tape, k, roles.get(k, "band member")), range(len(tape["photos"]))):
            print(tid, *r, flush=True)
