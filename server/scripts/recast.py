"""Cast an existing release's band (cast.py) and save it on the tape: recast.py <tid>[:<k>] [...]"""
import json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402
from songbird import cast, config  # noqa: E402

def member(job):
    tid, tape, k, role = job
    d, p = config.TAPES / tid, tape["photos"][k]
    cut = Image.open(d / f"cut-{k}.png") if (d / f"cut-{k}.png").exists() else None
    try:
        r = cast.performer(Image.open(d / f"photo-{k}.jpg"), cut, p["hero"], role, tape["genre"], tape.get("style"))
    except Exception as e:
        return tid, k, f"failed: {str(e)[:80]}"
    if not r:
        return tid, k, "no figure"
    r[0].save(d / f"cast-{k}.png")
    r[1].save(d / f"cast-{k}-art.png")  # the painting, so the key can be redone without repainting
    return tid, k, f"/tapes/{tid}/cast-{k}.png"

# args: <tid> for the whole band, or <tid>:<k> for one member
want = {}
for a in sys.argv[1:]:
    tid, _, k = a.partition(":")
    want.setdefault(tid, set()).update([int(k)] if k else [])
tapes = {tid: json.loads((config.TAPES / tid / "tape.json").read_text()) for tid in want}
jobs = []
for tid, tape in tapes.items():
    roles = {b["photo"]: b["role"] for b in tape.get("band", [])}
    jobs += [(tid, tape, k, roles.get(k, "band member")) for k in range(len(tape["photos"])) if not want[tid] or k in want[tid]]
with ThreadPoolExecutor(8) as ex:
    for tid, k, res in ex.map(member, jobs):
        print(tid, k, res, flush=True)
        if res.startswith("/tapes/"):
            tapes[tid]["photos"][k]["performer"] = res
for tid, tape in tapes.items():
    (config.TAPES / tid / "tape.json").write_text(json.dumps(tape, indent=1))
