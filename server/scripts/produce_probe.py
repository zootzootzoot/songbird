"""Draft a single for an existing release's look, the way the pipeline does: produce_probe.py <tid>"""
import json, sys, time, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from songbird import producer
tid = sys.argv[1]
look = json.load(open(f"data/tapes/{tid}/log.json"))["look"]
order = look.get("order") or list(range(len(look["photos"])))
t = time.time()
song = producer.write(look, order, "ada", None, on_try=lambda r, s, i: print(f"  round {r} at {time.time() - t:.0f}s: {s.get('style')} | {len(i)} issues"))
print(f"{time.time() - t:.0f} s | {song['genre']} | {song.get('style')} | {song['title']}")
print("why:", song["why"]); print("caption:", song["caption"]); print(producer.lyrics_text(song)); print("liner:", song["liner"]); print("band:", song["band"])
