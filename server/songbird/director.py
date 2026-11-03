"""The director: Muse Spark 1.3 reads the finished single and writes the music video's shot list.

The video has a vocabulary (shots, camera moves, effects); the director decides, line by line, which members are in
frame and how the camera treats them, from the lyrics, the band's roles and the genre. So no two videos are staged
alike, and a line about the pigeon is the pigeon's close-up.
"""
from __future__ import annotations

from . import config, meta

SHOTS = ["close-up", "two-shot", "wide", "solo", "lineup", "photo", "low-angle"]
MOVES = ["static", "push-in", "pull-out", "pan-left", "pan-right", "orbit", "handheld", "snap-zoom", "crane-up"]
FX = ["none", "strobe", "freeze", "echo", "split", "spotlight", "flash"]

_SHOT = {"type": "object", "additionalProperties": False, "required": ["shot", "subjects", "move", "fx"],
         "properties": {"shot": {"type": "string", "enum": SHOTS},
                        "subjects": {"type": "array", "items": {"type": "integer"}},
                        "move": {"type": "string", "enum": MOVES},
                        "fx": {"type": "string", "enum": FX}}}
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["concept", "intro", "shots", "outro"],
    "properties": {
        "concept": {"type": "string", "description": "the video's idea in one dry sentence"},
        "intro": _SHOT,
        "shots": {"type": "array", "items": {**_SHOT, "required": ["line", *_SHOT["required"]],
                                             "properties": {"line": {"type": "integer"}, **_SHOT["properties"]}}},
        "outro": _SHOT,
    }}

PROMPT = """You direct the music video for this single. It is staged with the band below: each member is a real object
from someone's day, dressed as a {genre} musician.

Single: "{title}", {genre}, {bpm} bpm.
The band (index: who, role):
{band}

The lyrics, in order, with when each line is sung:
{lines}

Write the shot list: one shot per line, plus an intro (before the first line) and an outro.
Vocabulary:
- shot: close-up (one member fills the frame), two-shot (two members share it, a duet or a stand-off), wide (the
  whole band on stage), solo (one member alone in a spotlight, everyone else gone), lineup (the band in a row,
  chorus energy), photo (the real photo the member came from fills the screen behind them), low-angle (a heroic
  shot from below).
- subjects: band indexes in frame (one for close-up, solo, photo, low-angle; two for two-shot; all for wide/lineup).
- move: static, push-in, pull-out, pan-left, pan-right, orbit, handheld, snap-zoom, crane-up.
- fx: none, strobe, freeze, echo, split, spotlight, flash.
Direct it like someone with taste and a point of view:
- A line about a member features that member. Give every member at least one moment of their own.
- Choruses go big (wide, lineup, strobe on the hook); verses stay close; the bridge does something unexpected.
- Never the same shot three times in a row. Build: the final chorus is the biggest moment of the video.
- Camera work with range: use at least five different moves across the video and never the same move more than
  twice in a row. Lean on the ones that belong to {genre} (tango leans on orbit and spotlight, punk on handheld and
  snap-zoom, a power ballad on crane-up and pull-out, disco on strobe and push-in) without living on them.
- Use "none" fx most of the time, so the fx land when they come.
"""


def direct(title: str, genre: str, bpm: int, band: list[dict], lines: list[dict]) -> dict | None:
    """band: [{"photo", "hero", "role"}]; lines: [{"text", "section", "photo", "start"}]. -> shot list, cleaned."""
    n = len(band)
    prompt = PROMPT.format(
        title=title, genre=genre, bpm=bpm,
        band="\n".join(f"{b['photo']}: the {b['hero']}, {b['role']}" for b in band),
        lines="\n".join(f"{i}. [{ln.get('section') or ''} {ln['start']:.0f}s] {ln['text']}"
                        + (f"  (about {ln['photo']})" if ln.get("photo") is not None else "") for i, ln in enumerate(lines)))
    try:
        plan = meta.spark_json([{"role": "user", "content": prompt}], SCHEMA, "shot_list", effort="low", model=config.SPARK)
    except Exception:
        return None
    members = {b["photo"] for b in band}

    def clean(s: dict) -> dict:
        subj = [k for k in s.get("subjects", []) if k in members] or sorted(members)[:1]
        return {"shot": s.get("shot", "wide"), "subjects": subj, "move": s.get("move", "static"), "fx": s.get("fx", "none")}

    by_line = {s["line"]: clean(s) for s in plan.get("shots", []) if 0 <= s.get("line", -1) < len(lines)}
    if len(by_line) < len(lines) * 0.6:
        return None
    shots, last = [], clean({"shot": "wide", "subjects": sorted(members)})
    for i in range(len(lines)):
        last = by_line.get(i, last)
        shots.append(dict(last))
    # the camera never sits on one move for long, whatever the model wrote
    swap = ["push-in", "pull-out", "pan-left", "static", "pan-right", "crane-up"]
    for i in range(3, len(shots)):
        if len({shots[j]["move"] for j in range(i - 3, i + 1)}) == 1:
            shots[i]["move"] = next(m for m in swap[i % len(swap):] + swap if m != shots[i]["move"])
    return {"concept": plan.get("concept", ""), "intro": clean(plan.get("intro", {})), "shots": shots,
            "outro": clean(plan.get("outro", {})), "members": n}
