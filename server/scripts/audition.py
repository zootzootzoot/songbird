"""Audition the session band in every repertoire style: one short clip per style, same neutral lyric.
Run with the acestep venv: audition.py [seed]   -> data/audition/<style>.mp3
Then judge with judge_audition.py (server venv)."""
import os
import sys
from pathlib import Path

ACE = Path(os.environ.get("ACE_DIR", Path.home() / "rea-work/acestep"))
SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ACE))
os.chdir(ACE)
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402

sys.path.insert(0, str(SERVER / "songbird"))
REPERTOIRE = __import__("ast").literal_eval(
    (SERVER / "songbird/producer.py").read_text(encoding="utf-8").split("REPERTOIRE = ", 1)[1].split("]", 1)[0] + "]")

LYRICS = """[Verse 1]
the corner store is open late
the neon hums a steady tune
we count the coins out on the step
and split a soda under the moon

[Chorus]
turn it up, turn it up tonight
the whole street knows the words
turn it up, turn it up tonight"""

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 5
out = SERVER / "data" / "audition"
out.mkdir(parents=True, exist_ok=True)
dit = AceStepHandler()
dit.initialize_service(project_root=str(ACE), config_path=os.environ.get("ACE_DIT", "acestep-v15-turbo"), device="cuda")
for style in REPERTOIRE:
    dest = out / f"{style.replace(' ', '_')}-{seed}.mp3"
    if dest.exists():
        continue
    params = GenerationParams(caption=f"{style}, full band, energetic, lead vocal upfront, {style}", lyrics=LYRICS,
                              vocal_language="en", duration=40.0, thinking=False, use_cot_caption=False)
    res = generate_music(dit, LLMHandler(), params, GenerationConfig(batch_size=1, audio_format="mp3",
                                                                     use_random_seed=False, seeds=[seed]),
                         save_dir=str(out / "raw"))
    if res.success:
        os.replace(res.audios[0]["path"], dest)
        print(style, flush=True)
