"""The session band: ACE-Step 1.5 (open source, MIT) kept warm on the GPU, recording takes sent over stdin.

Runs inside ACE-Step's own venv:  <acestep>/.venv/Scripts/python.exe band_worker.py

  in:  {"id", "caption", "lyrics", "bpm", "key", "duration", "takes": 4, "seed": 7, "out_dir", "language": "en"}
  out: {"id": null, "event": "ready"}
       {"id", "event": "take", "index": 0, "path": ".../take-0.mp3", "lrc": "[00:12.34]line...", "seconds": 9.1,
        "tuning": {"bandKey": "F major", "vocalKey": "F major", "inKey": 0.85}}

The 5Hz LM only plans the metadata here. When it also wrote the melody codes ("thinking"), the vocal came out in a
different key from the band on every take we measured (F# minor over F major); the DiT alone keeps them together
and is 6x faster. See tuner.py and docs/META_LOG.md.
       {"id", "event": "done"} | {"id", "event": "error", "message"}
"""
import gc
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

import torch

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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tuner  # noqa: E402
import fa  # noqa: E402

CK = ACE / "checkpoints"
DIT = os.environ.get("ACE_DIT", "acestep-v15-xl-turbo")  # the owner preferred XL over the 2B by ear
LM = os.environ.get("ACE_LM", "none")
THINK = os.environ.get("ACE_THINK", "0") == "1"
dit, lm = AceStepHandler(), LLMHandler()
dit.initialize_service(project_root=str(ACE), config_path=DIT, device="cuda")
if LM != "none":  # the LM only plans metadata now, and we hand the DiT bpm, key and length ourselves
    lm.initialize(checkpoint_dir=str(CK), lm_model_path=LM, backend="pt", device="cuda")
send({"id": None, "event": "ready"})


def free():
    """Hand back what the last take and the tuner held on the GPU."""
    gc.collect()
    torch.cuda.empty_cache()


def record(job):
    out = Path(job["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    takes = int(job.get("takes", 4))
    params = GenerationParams(caption=job["caption"], lyrics=job["lyrics"], vocal_language=job.get("language", "en"),
                              bpm=job.get("bpm"), keyscale=job.get("key", ""), timesignature=job.get("time", ""),
                              duration=float(job.get("duration", -1)), thinking=THINK,
                              use_cot_caption=False)  # play the producer's session notes as written
    seeds = [int(job.get("seed", 7)) + 101 * k for k in range(takes)]
    k, last_error = 0, "generation failed"
    for seed in seeds:  # one take at a time: the XL band leaves no room on 16 GB for a batch
        t = time.time()
        res = None
        for attempt in range(2):  # a long slow song can leave the next take short of VRAM: free it and try once more
            res = generate_music(dit, lm, params, GenerationConfig(batch_size=1, audio_format="mp3", use_random_seed=False,
                                                                   seeds=[seed]), save_dir=str(out / "raw"))
            if res.success:
                break
            last_error = res.error or last_error
            free()
        if not res.success:  # skip this seed; take indexes stay contiguous, and the session goes on
            print(f"take with seed {seed} failed: {last_error}", file=sys.stderr, flush=True)
            continue
        eo, a = res.extra_outputs, res.audios[0]
        took = round(time.time() - t, 1)
        dest = out / f"take-{k}.mp3"
        shutil.copy2(a["path"], dest)
        lrc = ""
        try:
            r = dit.get_lyric_timestamp(pred_latent=eo["pred_latents"][:1],
                                        encoder_hidden_states=eo["encoder_hidden_states"][:1],
                                        encoder_attention_mask=eo["encoder_attention_mask"][:1],
                                        context_latents=eo["context_latents"][:1],
                                        lyric_token_ids=eo["lyric_token_idss"][:1],
                                        total_duration_seconds=float(eo["pred_latents"].shape[1] / 25.0),
                                        vocal_language=job.get("language", "en"), inference_steps=8, seed=42)
            if r.get("success"):
                lrc = r.get("lrc_text", "")
        except Exception:
            traceback.print_exc()
        meta = a.get("params") if isinstance(a.get("params"), dict) else {}
        tuning = {}
        for device in ("cuda", "cpu"):
            try:
                tuning = tuner.measure(str(dest), device, vocal_out=str(out / f"vocal-{k}.wav"))
                break
            except Exception:
                traceback.print_exc()
                torch.cuda.empty_cache()
        send({"id": job["id"], "event": "take", "index": k, "path": str(dest), "lrc": lrc, "seconds": took,
              "seed": seed, "key": meta.get("keyscale"), "bpm": meta.get("bpm"), "tuning": tuning,
              "vocal": str(out / f"vocal-{k}.wav") if (out / f"vocal-{k}.wav").exists() else None})  # a["key"] is the file id
        k += 1
        del res, eo, a
        free()
    if k == 0:
        raise RuntimeError(last_error)
    send({"id": job["id"], "event": "done"})


for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    job = None
    try:
        job = json.loads(raw)
        if job.get("op") == "retime":  # word times for the kept take (Meta's MMS aligner on the Demucs vocal)
            send({"id": job["id"], "event": "retimed", "lines": fa.retime(job["lines"], job["vocal"])})
        else:
            record(job)
    except Exception as e:
        traceback.print_exc()
        send({"id": job.get("id") if isinstance(job, dict) else None, "event": "error", "message": str(e)[:500]})
