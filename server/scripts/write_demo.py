import sys, json, time; sys.path.insert(0, '.')
from pathlib import Path
from PIL import Image
from songbird import writer
photos = [Image.open(p) for p in sorted(Path("samples/sunday").glob("*.jpg"))]
t = time.time(); lk = writer.look(photos); print("look", round(time.time()-t,1), "s")
print(json.dumps(lk, indent=1))
t = time.time()
song = writer.write(lk, name="Maya", on_try=lambda r, s, i: print("try", r, round(time.time()-t,1), "s", i))
print(json.dumps(song, indent=1))
Path("data/write_demo.json").write_text(json.dumps({"look": lk, "song": song}, indent=1))
