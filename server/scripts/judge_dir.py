"""Have Muse Spark 1.2 judge every take in folders: the A&R score (knows the brief) and a blind genre guess (doesn't).
  judge_dir.py <tid> <folder> [folder ...]"""
import base64
import glob
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import meta, producer  # noqa: E402

BLIND = """Listen to this audio clip. Answer in exactly this format:
GENRE: <the most specific genre and era it sounds like>
DRUMS: <what the drums play, a few words>
FEEL: <three words>"""


def blind(f):
    w = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-ss", "20", "-t", "40", "-ac", "1", "-ar", "16000", "-f", "wav", "-"],
                       capture_output=True, check=True).stdout
    j = meta._post("/chat/completions", {"model": "muse-spark-1.2", "messages": [{"role": "user", "content": [
        {"type": "text", "text": BLIND}, {"type": "input_audio", "input_audio": {"data": base64.b64encode(w).decode(), "format": "wav"}}]}]})
    return " | ".join(l.strip() for l in (j["choices"][0]["message"]["content"] or "").splitlines() if l.strip())[:220]


song = json.load(open(f"data/tapes/{sys.argv[1]}/log.json"))["song"]
lyr = producer.lyrics_text(song)
files = [f for d in sys.argv[2:] for f in sorted(glob.glob(os.path.join(d, "*.mp3")))]
with ThreadPoolExecutor(8) as ex:
    ar = list(ex.map(lambda f: producer.listen(f, song["genre"], lyr), files))
    bl = list(ex.map(blind, files))
print("asked for:", song["genre"], "/", song.get("style"))
for f, a, b in zip(files, ar, bl):
    print(f"{Path(f).parent.name:>22} {Path(f).stem[:8]} voice {a['voice']:.0f} words {a['words']:.0f} genre {a['genre']:.0f} | {a['verdict'][:90]}")
    print(f"{'':>31} blind: {b}")
