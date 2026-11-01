"""Make one tape from a folder of photos without the web server, printing events as they happen."""
import sys, time, json; sys.path.insert(0, '.')
from pathlib import Path
from songbird import pipeline
folder, name = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
blobs = [p.read_bytes() for p in sorted(Path(folder).glob("*.jpg"))]
t = time.time()
job = pipeline.new_tape(blobs, name, None)
seen = 0
while True:
    with job.cond:
        job.cond.wait(1)
        evs = job.events[seen:]; seen = len(job.events); fin = job.finished
    for e in evs:
        if e["type"] == "done":
            print(f"{time.time()-t:6.1f}s done", job.id); continue
        print(f"{time.time()-t:6.1f}s", json.dumps(e)[:160])
    if fin: break
