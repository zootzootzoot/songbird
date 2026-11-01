import sys, json, time; sys.path.insert(0, '.')
from songbird import writer
lk = json.load(open("data/write_demo.json"))["look"]
model = sys.argv[1]; effort = sys.argv[2]
t = time.time()
s = writer.write(lk, name="Maya", model=model, effort=effort, on_try=lambda r, s, i: print(model, "try", r, round(time.time()-t,1), "s", i))
print(f"== {model} {effort}: {s['title']} | {s['mode']} {s['bpm']} {s['meter']}/4 {s['palette']}")
for v in s["verses"]: print("  ", v["photo"], v["text"])
print("  R:", s["refrain"]); print("  L:", s["last_line"]); print("  liner:", s["liner"])
