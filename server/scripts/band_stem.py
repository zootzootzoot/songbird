"""Write the band without the singer (Demucs): band_stem.py out_dir in.mp3 ... (acestep venv)"""
import sys
from pathlib import Path
import numpy as np, soundfile as sf
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "songbird"))
import tuner
out = Path(sys.argv[1])
for p in sys.argv[2:]:
    d, sr = tuner.stems(p)
    band = d["drums"] + d["bass"] + d["other"]
    sf.write(out / (Path(p).parent.name + "-" + Path(p).stem[:8] + ".wav"), (band / max(1e-6, np.abs(band).max()) * 0.9).astype(np.float32), sr)
    print("wrote", p, flush=True)
