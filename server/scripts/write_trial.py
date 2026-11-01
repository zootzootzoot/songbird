import sys, json, time; sys.path.insert(0, '.')
from songbird import writer
tid, model, effort, name = sys.argv[1:5]
lk = json.load(open(f"data/tapes/{tid}/log.json"))["look"]
t = time.time()
s = writer.write(lk, name=name, model=model, effort=effort, on_try=lambda r, s, i: print(f"  try {r} {time.time()-t:.0f}s issues={i}"))
print(f"== {model} {effort} {time.time()-t:.0f}s: {s['title']}")
for v in s["verses"]: print("   ", v["text"])
print("    R:", s["refrain"], "| L:", s["last_line"]); print("    liner:", s["liner"])
