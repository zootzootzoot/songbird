"""Trial ACE-Step 1.5 on a Songbird lyric in several genres (run with the acestep venv, cwd = acestep repo)."""
import json
import os
import sys
import time
from pathlib import Path

ACE = Path(os.environ.get("ACE_DIR", Path.home() / "rea-work/acestep"))
sys.path.insert(0, str(ACE))
os.chdir(ACE)

from acestep.handler import AceStepHandler  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402
from acestep.inference import GenerationParams, GenerationConfig, generate_music  # noqa: E402
from acestep.model_downloader import ensure_dit_model, ensure_lm_model  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "data" / "ace"
OUT.mkdir(parents=True, exist_ok=True)
ck = ACE / "checkpoints"
t = time.time()
print(ensure_dit_model("acestep-v15-turbo", ck))
print(ensure_lm_model("acestep-5Hz-lm-1.7B", checkpoints_dir=ck))
print("download", round(time.time() - t), "s", flush=True)

dit, lm = AceStepHandler(), LLMHandler()
dit.initialize_service(project_root=str(ACE), config_path="acestep-v15-turbo", device="cuda")
lm.initialize(checkpoint_dir=str(ck), lm_model_path="acestep-5Hz-lm-1.7B", backend="pt", device="cuda")

LYRICS = """[Verse 1]
Your yellow rain boots splashed the street
The pigeon danced on two small feet
The ice cream cone dripped sweet and pink
You touched the bus window with a wink

[Chorus]
Sleep now, Ada, sleep now, love
The city lights are up above

[Verse 2]
Your red balloon has gone to sleep
The city lights will watch you sleep

[Chorus]
Sleep now, Ada, sleep now, love
The city lights are up above"""

STYLES = {
    "folk": "warm intimate indie folk, fingerpicked acoustic guitar, soft upright bass, brushed drums, gentle male vocal, close-mic, cozy, analog",
    "soul": "1960s soul ballad, warm female vocal, rhodes piano, tape saturation, light strings, slow groove, vintage Motown",
    "kids": "joyful children's TV song, ukulele, glockenspiel, handclaps, bouncy bass, cheerful warm female vocal, Sesame Street style",
}
which = sys.argv[1:] or list(STYLES)
for name in which:
    t = time.time()
    params = GenerationParams(caption=STYLES[name], lyrics=LYRICS, vocal_language="en", duration=70, thinking=True)
    cfg = GenerationConfig(batch_size=1, audio_format="mp3")
    res = generate_music(dit, lm, params, cfg, save_dir=str(OUT / name))
    took = round(time.time() - t, 1)
    if not res.success:
        print(name, "FAILED", res.error, flush=True)
        continue
    a = res.audios[0]
    lrc = None
    try:
        eo = res.extra_outputs
        r = dit.get_lyric_timestamp(pred_latent=eo["pred_latents"][0:1], encoder_hidden_states=eo["encoder_hidden_states"][0:1],
                                    encoder_attention_mask=eo["encoder_attention_mask"][0:1], context_latents=eo["context_latents"][0:1],
                                    lyric_token_ids=eo["lyric_token_idss"][0:1], total_duration_seconds=70.0,
                                    vocal_language="en", inference_steps=8, seed=42)
        lrc = r.get("lrc_text") if r.get("success") else r
    except Exception as e:
        lrc = f"lrc error: {e}"
    (OUT / f"{name}.lrc.txt").write_text(str(lrc), encoding="utf-8")
    print(name, took, "s", a["path"], a.get("key"), a["params"].get("bpm") if isinstance(a.get("params"), dict) else "", flush=True)
