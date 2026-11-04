"""Release each sample day through the running server, one at a time: release_days.py [slug ...]

Reads samples/<slug>/day.json for whose day it was and their note. Appends "slug tid" to data/released.txt.
"""
import sys, json, time, httpx
from pathlib import Path

root = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8787"
log = root / "data" / "released.txt"
slugs = sys.argv[1:]


def release(slug: str) -> str | None:
    folder = root / "samples" / slug
    day = json.loads((folder / "day.json").read_text())
    files = [("photos", (p.name, p.read_bytes(), "image/jpeg")) for p in sorted(folder.glob("photo-*.jpg"))]
    r = httpx.post(f"{API}/api/tapes", files=files, data={"name": day["name"], "note": day["note"]}, timeout=60)
    tid = r.json()["id"]
    t0 = time.time()
    print(f"{slug} {tid}", flush=True)
    with httpx.stream("GET", f"{API}/api/tapes/{tid}/events", timeout=None) as s:
        for line in s.iter_lines():
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:])
            if ev["type"] in ("genre", "verdict", "error", "kept"):
                print(f"  {time.time() - t0:5.0f}s {json.dumps(ev)[:220]}", flush=True)
            if ev["type"] == "error":
                return None
            if ev["type"] == "done":
                print(f"  done in {time.time() - t0:.0f}s", flush=True)
                with log.open("a") as f:
                    f.write(f"{slug} {tid}\n")
                return tid
    return None


def band_ready() -> bool:
    try:
        return bool(httpx.get(f"{API}/api/health", timeout=10).json().get("band"))
    except httpx.HTTPError:
        return False


while not band_ready():
    time.sleep(5)
for s in slugs:
    try:
        release(s)
    except Exception as e:
        print(f"{s} failed: {e}", flush=True)
