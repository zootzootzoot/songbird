"""Make a tape through the running server: make_via_api.py <photo folder> [name] [note]"""
import sys, json, httpx
from pathlib import Path
folder = Path(sys.argv[1]); name = sys.argv[2] if len(sys.argv) > 2 else ""; note = sys.argv[3] if len(sys.argv) > 3 else ""
files = [("photos", (p.name, p.read_bytes(), "image/jpeg")) for p in sorted(folder.glob("*.jpg"))]
r = httpx.post("http://127.0.0.1:8787/api/tapes", files=files, data={"name": name, "note": note}, timeout=60)
tid = r.json()["id"]; print(tid, flush=True)
with httpx.stream("GET", f"http://127.0.0.1:8787/api/tapes/{tid}/events", timeout=None) as s:
    for line in s.iter_lines():
        if line.startswith("data:"):
            ev = json.loads(line[5:])
            if ev["type"] in ("title", "line", "error"): print(json.dumps(ev)[:150], flush=True)
            if ev["type"] == "done": print("done", tid); break
