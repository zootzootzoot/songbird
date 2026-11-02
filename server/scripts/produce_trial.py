import sys, json, time; sys.path.insert(0, '.')
from songbird import producer
tid, name = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
note = sys.argv[3] if len(sys.argv) > 3 else None
lk = json.load(open(f"data/tapes/{tid}/log.json"))["look"]
order = lk["order"]
t = time.time()
s = producer.write(lk, order, name, note, on_try=lambda r, s, i: print(f"  try {r} {time.time()-t:.0f}s issues={i}", flush=True))
print(f"== {s['title']} | {s['genre']} | {s['bpm']} bpm {s['key']} {s['vocal']}")
print("why:", s["why"]); print("caption:", s["caption"])
print(producer.lyrics_text(s))
print("band:", "; ".join(f"{lk['photos'][order[b['photo']]]['hero']}: {b['role']}" for b in s["band"] if b['photo'] < len(order)))
print("liner:", s["liner"])
json.dump(s, open(f"data/produce_{tid}.json", "w"), indent=1)
