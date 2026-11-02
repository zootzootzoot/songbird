"""Record one release's song under several ACE-Step settings to find why the vocal leaves the band's key.
Run with the acestep venv:  key_trial.py <tid> [variant ...]   (outputs in data/key_trial/<tid>/<variant>/)"""
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

VARIANTS = {  # name: (thinking, pass the key, extra params)
    "lm_key": (True, True, {}),
    "lm_nokey": (True, False, {}),
    "dit_key": (False, True, {}),
    "dit_nokey": (False, False, {}),
    "dit_more": (False, True, {}),
}
SEEDS = {"dit_more": [3, 204, 305, 406]}
tid = sys.argv[1]
names = sys.argv[2:] or list(VARIANTS)
song = json.loads((SERVER / "data/tapes" / tid / "log.json").read_text())["song"]
lyrics = "\n".join(f"[{s['tag']}]\n" + "\n".join(l["text"] for l in s["lines"]) + "\n" for s in song["sections"]).strip()
n_lines = sum(len(s["lines"]) for s in song["sections"])
duration = max(60.0, min(150.0, n_lines * 8 * 60 / song["bpm"] + 14))
dit, lm = AceStepHandler(), LLMHandler()
dit.initialize_service(project_root=str(ACE), config_path=os.environ.get("ACE_DIT", "acestep-v15-turbo"), device="cuda")
if os.environ.get("NO_LM") != "1":  # without it the DiT plays from our bpm/key/duration alone
    lm.initialize(checkpoint_dir=str(ACE / "checkpoints"), lm_model_path=os.environ.get("ACE_LM", "acestep-5Hz-lm-1.7B"),
                  backend="pt", device="cuda")
for name in names:
    thinking, with_key, extra = VARIANTS[name]
    out = SERVER / "data" / "key_trial" / tid / (name + os.environ.get("TAG", ""))
    seeds = SEEDS.get(name, [11, 112])
    t = time.time()
    cap = song["caption"] if song["caption"].lower().startswith(song.get("style", "~")) else f"{song.get('style')}, {song['caption']}"
    params = GenerationParams(caption=os.environ.get("CAPTION") or cap, lyrics=lyrics, vocal_language="en", bpm=song["bpm"],
                              keyscale=song["key"] if with_key else "", duration=duration, thinking=thinking,
                              inference_steps=int(os.environ.get("STEPS", 8)),
                              use_cot_caption=False, **extra)
    res = generate_music(dit, lm, params, GenerationConfig(batch_size=len(seeds), audio_format="mp3",
                                                           use_random_seed=False, seeds=seeds), save_dir=str(out))
    print(name, "took", round(time.time() - t, 1), "s", flush=True)
    for k, a in enumerate(res.audios):
        meta = a.get("params") if isinstance(a.get("params"), dict) else {}
        print(" ", k, a["path"], meta.get("keyscale"), meta.get("bpm"), flush=True)
