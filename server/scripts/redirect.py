"""Have the director write an existing release's shot list onto the tape: redirect.py <tid> [...]"""
import json, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import config, director  # noqa: E402

def one(tid):
    f = config.TAPES / tid / "tape.json"
    t = json.loads(f.read_text())
    band = [{"photo": b["photo"], "hero": t["photos"][b["photo"]]["hero"], "role": b["role"]} for b in t.get("band", [])]
    t0 = time.time()
    plan = director.direct(t["title"], t.get("genre", ""), t.get("bpm", 100), band, t["lines"])
    if plan:
        t["direction"] = plan
        f.write_text(json.dumps(t, indent=1))
    return tid, round(time.time() - t0, 1), plan

with ThreadPoolExecutor(8) as ex:
    for tid, secs, plan in ex.map(one, sys.argv[1:]):
        print(tid, secs, "s", "FAILED" if not plan else plan["concept"])
        if plan and "-v" in sys.argv[0:1] + sys.argv:
            pass
