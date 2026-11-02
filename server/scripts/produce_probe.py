"""Probe Wonder's first draft: produce_probe.py <tid> <effort> [model]"""
import json, sys, time
import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from songbird import meta, producer
tid, effort = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else "muse-wonder-1.0"
log = json.load(open(f"data/tapes/{tid}/log.json"))
look = log["look"]; order = look.get("order") or list(range(len(look["photos"])))
seen = [look["photos"][i] for i in order]
photos = "\n".join(f"{k}. hero: {p['hero']}. {p['seen']}. details: {'; '.join(p['details'])}. {p['time_of_day']}." for k, p in enumerate(seen))
prompt = producer.PRODUCE_PROMPT.format(who=" for ada", photos=photos, day=look.get("day", ""), note="")
t = time.time()
song = meta.spark_json([{"role": "user", "content": prompt}], producer.PRODUCE_SCHEMA, "single", effort=effort, model=model)
print(effort, model, round(time.time() - t, 1), "s", "sections:", [(s["tag"], len(s["lines"])) for s in song["sections"]])
print("issues:", producer.problems(song, len(seen)))
print("why:", song["why"]); print("title:", song["title"], "|", song["genre"]); print(producer.lyrics_text(song)); print("liner:", song["liner"]); print("band:", song["band"])
