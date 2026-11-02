"""Record a producer song (data/produce_<tid>.json) with ACE-Step: ace_song.py <tid> <dit model> [takes]
Run with the acestep venv."""
import json
import os
import sys
import time
from pathlib import Path

ACE = Path(os.environ.get("ACE_DIR", Path.home() / "rea-work/acestep"))
SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ACE))
os.chdir(ACE)
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402
from acestep.model_downloader import ensure_dit_model  # noqa: E402

tid, model = sys.argv[1], sys.argv[2]
takes = int(sys.argv[3]) if len(sys.argv) > 3 else 2
song = json.loads((SERVER / f"data/produce_{tid}.json").read_text())
lyrics = "\n".join(f"[{s['tag']}]\n" + "\n".join(l["text"] for l in s["lines"]) + "\n" for s in song["sections"]).strip()
n_lines = sum(len(s["lines"]) for s in song["sections"])
duration = max(60.0, min(150.0, n_lines * 8 * 60 / song["bpm"] + 14))
print(ensure_dit_model(model, ACE / "checkpoints"), flush=True)
dit, lm = AceStepHandler(), LLMHandler()
dit.initialize_service(project_root=str(ACE), config_path=model, device="cuda")
lm.initialize(checkpoint_dir=str(ACE / "checkpoints"), lm_model_path="acestep-5Hz-lm-1.7B", backend="pt", device="cuda")
out = SERVER / "data" / "ace_song" / f"{tid}-{model}{os.environ.get('TAG', '')}"
t = time.time()
params = GenerationParams(caption=song["caption"], lyrics=lyrics, vocal_language="en", bpm=song["bpm"],
                          keyscale=song["key"], duration=duration, thinking=True, use_cot_caption=False,
                          inference_steps=8 if "turbo" in model else 50)
res = generate_music(dit, lm, params, GenerationConfig(batch_size=takes, audio_format="mp3", use_random_seed=False,
                                                       seeds=[11 + 101 * k for k in range(takes)]), save_dir=str(out))
print(model, "took", round(time.time() - t, 1), "s for", takes, "takes of", round(duration), "s", flush=True)
for a in res.audios:
    print(" ", a["path"], flush=True)
