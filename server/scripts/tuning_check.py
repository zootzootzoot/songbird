"""Does the singer agree with the band?  <acestep venv python> tuning_check.py take.mp3 [more.mp3 ...]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "songbird"))
import tuner  # noqa: E402

for p in sys.argv[1:]:
    print(Path(p).name, tuner.measure(p), flush=True)
