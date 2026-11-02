"""The session band: ACE-Step 1.5 (open source, MIT) kept warm on the GPU, recording takes sent over stdin.

Runs inside ACE-Step's own venv:  <acestep>/.venv/Scripts/python.exe band_worker.py

  in:  {"id", "caption", "lyrics", "bpm", "key", "duration", "takes": 2, "seed": 7, "out_dir", "language": "en"}
  out: {"id": null, "event": "ready"}
       {"id", "event": "take", "index": 0, "path": ".../take-0.mp3", "lrc": "[00:12.34]line...", "seconds": 9.1}
       {"id", "event": "done"} | {"id", "event": "error", "message"}
"""
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

ACE = Path(os.environ.get("ACE_DIR", Path(__file__).resolve().parents[3] / "rea-work/acestep")).resolve()
_stdout = sys.stdout
sys.stdout = sys.stderr


def send(obj):
    _stdout.write(json.dumps(obj) + "\n")
    _stdout.flush()


sys.path.insert(0, str(ACE))
os.chdir(ACE)
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402

CK = ACE / "checkpoints"
DIT = os.environ.get("ACE_DIT", "acestep-v15-turbo")
LM = os.environ.get("ACE_LM", "acestep-5Hz-lm-1.7B")
dit, lm = AceStepHandler(), LLMHandler()
dit.initialize_service(project_root=str(ACE), config_path=DIT, device="cuda")
lm.initialize(checkpoint_dir=str(CK), lm_model_path=LM, backend="pt", device="cuda")
send({"id": None, "event": "ready"})


def record(job):
    out = Path(job["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    takes = int(job.get("takes", 2))
    params = GenerationParams(caption=job["caption"], lyrics=job["lyrics"], vocal_language=job.get("language", "en"),
                              bpm=job.get("bpm"), keyscale=job.get("key", ""), timesignature=job.get("time", ""),
                              duration=float(job.get("duration", -1)), thinking=True,
                              use_cot_caption=False)  # play the producer's session notes as written
    seeds = [int(job.get("seed", 7)) + 101 * k for k in range(takes)]
    cfg = GenerationConfig(batch_size=takes, audio_format="mp3", use_random_seed=False, seeds=seeds)
    t = time.time()
    res = generate_music(dit, lm, params, cfg, save_dir=str(out / "raw"))
    if not res.success:
        raise RuntimeError(res.error or "generation failed")
    eo = res.extra_outputs
    took = round(time.time() - t, 1)
    for k, a in enumerate(res.audios):
        dest = out / f"take-{k}.mp3"
        shutil.copy2(a["path"], dest)
        lrc = ""
        try:
            dur = float(eo["pred_latents"].shape[1] / 25.0)
            r = dit.get_lyric_timestamp(pred_latent=eo["pred_latents"][k:k + 1],
                                        encoder_hidden_states=eo["encoder_hidden_states"][k:k + 1],
                                        encoder_attention_mask=eo["encoder_attention_mask"][k:k + 1],
                                        context_latents=eo["context_latents"][k:k + 1],
                                        lyric_token_ids=eo["lyric_token_idss"][k:k + 1],
                                        total_duration_seconds=dur, vocal_language=job.get("language", "en"),
                                        inference_steps=8, seed=42)
            if r.get("success"):
                lrc = r.get("lrc_text", "")
        except Exception:
            traceback.print_exc()
        meta = a.get("params") if isinstance(a.get("params"), dict) else {}
        send({"id": job["id"], "event": "take", "index": k, "path": str(dest), "lrc": lrc, "seconds": took,
              "seed": seeds[k], "key": a.get("key") or meta.get("keyscale"), "bpm": meta.get("bpm")})
    send({"id": job["id"], "event": "done"})


for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    job = None
    try:
        job = json.loads(raw)
        record(job)
    except Exception as e:
        traceback.print_exc()
        send({"id": job.get("id") if isinstance(job, dict) else None, "event": "error", "message": str(e)[:500]})
