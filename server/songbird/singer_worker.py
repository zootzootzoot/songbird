"""SoulX-Singer worker: keeps the singing model loaded on the GPU and sings scores sent over stdin.

Runs inside SoulX-Singer's own venv (it pins torch/transformers versions the server should not inherit):
  <soulx>/.venv/Scripts/python.exe singer_worker.py

Protocol, one JSON object per line.
  in:  {"id": "...", "segments": [...SoulX score metadata with "offset" seconds...], "out": "vocal.wav",
        "seed": 7, "pitch": 0}
  out: {"id": "...", "event": "ready"}                       once, after the model loads
       {"id": "...", "event": "line", "index": 3, "seconds": 2.1}
       {"id": "...", "event": "done", "out": "...", "duration": 61.2}
       {"id": "...", "event": "error", "message": "..."}
Everything else goes to stderr.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio

SOULX = Path(os.environ.get("SOULX_DIR", Path(__file__).resolve().parents[3] / "rea-work/songlab/engines/soulx-singer")).resolve()
PROMPT_WAV = os.environ.get("SINGER_PROMPT_WAV", "")
PROMPT_META = os.environ.get("SINGER_PROMPT_META", str(SOULX / "example/audio/en_prompt.json"))
SR = 24000

_stdout = sys.stdout
sys.stdout = sys.stderr  # keep library prints off the protocol channel


def send(obj):
    _stdout.write(json.dumps(obj) + "\n")
    _stdout.flush()


def _sf_load(path, *args, **kwargs):
    y, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return torch.from_numpy(y.T.copy()), sr


torchaudio.load = _sf_load
sys.path.insert(0, str(SOULX))
os.chdir(SOULX)

from cli.inference import build_model  # noqa: E402
from soulxsinger.utils.data_processor import DataProcessor  # noqa: E402
from soulxsinger.utils.file_utils import load_config  # noqa: E402

prompt_wav = PROMPT_WAV or str(Path(__file__).resolve().parents[1] / "data" / "prompt.wav")
if not Path(prompt_wav).exists():
    Path(prompt_wav).parent.mkdir(parents=True, exist_ok=True)
    os.system(f'ffmpeg -v error -y -i "{SOULX / "example/audio/en_prompt.mp3"}" -ac 1 -ar {SR} "{prompt_wav}"')

config = load_config("soulxsinger/config/soulxsinger.yaml")
model = build_model("pretrained_models/SoulX-Singer/model.pt", config, "cuda", use_fp16=True)
dp = DataProcessor(hop_size=config.audio.hop_size, sample_rate=config.audio.sample_rate,
                   phoneset_path="soulxsinger/utils/phoneme/phone_set.json", device="cuda")
prompt = dp.process(json.load(open(PROMPT_META, encoding="utf-8"))[0], prompt_wav)
send({"id": None, "event": "ready"})


def sing(job):
    segs = job["segments"]
    seg_dir = job.get("seg_dir")  # also keep each line's take on its own (for listening back)
    end = max(s["offset"] + s["time"][1] / 1000 for s in segs) + 1
    track = np.zeros(int(end * SR), dtype=np.float32)
    fade = int(0.08 * SR)
    for k, s in enumerate(segs):
        t = time.time()
        meta = {key: v for key, v in s.items() if key not in ("offset", "seed", "take")}
        torch.manual_seed(int(s.get("seed", job.get("seed", 7))) + 1000 * k)
        with torch.no_grad():
            y = model.infer({"prompt": prompt, "target": dp.process(meta, None)}, auto_shift=False,
                            pitch_shift=int(job.get("pitch", 0)), n_steps=config.infer.n_steps, cfg=config.infer.cfg,
                            control="score", use_fp16=True)
        y = y.squeeze().float().cpu().numpy()
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
        if seg_dir:
            Path(seg_dir).mkdir(parents=True, exist_ok=True)
            sf.write(str(Path(seg_dir) / f"{s['index']}-{s.get('take', 0)}.wav"), y, SR)
        i = max(0, int(s["offset"] * SR))
        n = min(len(y), len(track) - i)
        track[i:i + n] += y[:n]
        send({"id": job["id"], "event": "line", "index": k, "seconds": round(time.time() - t, 2)})
    if job.get("out"):
        Path(job["out"]).parent.mkdir(parents=True, exist_ok=True)
        sf.write(job["out"], track, SR)
    send({"id": job["id"], "event": "done", "out": job["out"], "duration": round(len(track) / SR, 3)})


for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        job = json.loads(raw)
        sing(job)
    except Exception as e:  # keep the worker alive for the next job
        traceback.print_exc()
        send({"id": (job or {}).get("id") if isinstance(locals().get("job"), dict) else None,
              "event": "error", "message": str(e)[:500]})
