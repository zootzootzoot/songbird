"""Muse Spark 1.2 judges the band's audition: judge_audition.py -> data/audition/scores.json (style -> mean scores)"""
import glob
import json
import os
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import producer  # noqa: E402

LYR = "the corner store is open late / the neon hums a steady tune"
files = sorted(glob.glob("data/audition/*.mp3"))
style_of = lambda f: os.path.basename(f).rsplit("-", 1)[0].replace("_", " ")
with ThreadPoolExecutor(12) as ex:
    res = list(ex.map(lambda f: producer.listen(f, style_of(f), LYR, seconds=40), files))
by = defaultdict(list)
for f, r in zip(files, res):
    by[style_of(f)].append(r)
scores = {s: {k: round(sum(r[k] for r in rs) / len(rs), 1) for k in ("voice", "words", "genre")} | {"n": len(rs),
          "verdict": rs[0]["verdict"]} for s, rs in by.items()}
Path("data/audition/scores.json").write_text(json.dumps(scores, indent=1))
for s, v in sorted(scores.items(), key=lambda kv: -(kv[1]["genre"] + kv[1]["voice"])):
    print(f"{s:>18}  genre {v['genre']:>4}  voice {v['voice']:>4}  words {v['words']:>4}  | {v['verdict'][:90]}")
