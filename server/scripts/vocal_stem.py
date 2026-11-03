"""Write the isolated vocal (Demucs) of a take as 16 kHz mono wav: vocal_stem.py in.mp3 out.wav  (acestep venv)"""
import sys
from pathlib import Path
import numpy as np, soundfile as sf, torch, torchaudio
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "songbird"))
import tuner
d, sr = tuner.stems(sys.argv[1], "cuda" if torch.cuda.is_available() else "cpu")
v = torch.tensor(d["vocals"])[None]
v = torchaudio.functional.resample(v, sr, 16000)[0].numpy()
sf.write(sys.argv[2], (v / max(1e-6, np.abs(v).max()) * 0.9).astype(np.float32), 16000, subtype="PCM_16")
