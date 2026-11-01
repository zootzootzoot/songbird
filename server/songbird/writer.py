"""Muse Spark as the songwriter: it looks at the day's photos, then writes a song we can actually sing.

look()  one multimodal call over every photo: the hero of each picture (a SAM-ready noun phrase), what is
        happening, concrete details, light and mood, and the order the day probably happened in.
write() lyrics + a musical plan per line, constrained by a JSON schema, then checked by us (syllables counted
        against CMUdict, couplets checked for rhyme, every verse must name something from its photo) and sent
        back to Muse Spark with the problems until it passes.
"""
from __future__ import annotations

import json
import re

from PIL import Image

from . import compose, meta

MOODS = ["bright", "tender", "rainy", "sleepy", "playful"]
CONTOURS = list(compose.CONTOURS)

LOOK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["photos", "order", "day", "palette"],
    "properties": {
        "photos": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["index", "hero", "hero_alt", "seen", "details", "time_of_day", "mood"],
            "properties": {
                "index": {"type": "integer"},
                "hero": {"type": "string", "description": "1-3 word noun phrase naming ONE concrete, visible, cut-out-able thing that makes this photo special (an animal, toy, object, food). Not a face or a whole person. e.g. 'snail', 'rubber duck', 'red balloon'"},
                "hero_alt": {"type": "string", "description": "a simpler, more generic noun phrase for the same thing, used if the first finds nothing"},
                "seen": {"type": "string", "description": "what is happening, max 12 words, plain present tense"},
                "details": {"type": "array", "items": {"type": "string"}, "description": "3 small concrete sensory details a parent would remember (colour, texture, sound, smell)"},
                "time_of_day": {"type": "string", "enum": ["morning", "midday", "afternoon", "evening", "night"]},
                "mood": {"type": "string", "enum": MOODS},
            }}},
        "order": {"type": "array", "items": {"type": "integer"}, "description": "photo indexes in the order the day most likely happened, morning to bedtime"},
        "day": {"type": "string", "description": "one warm sentence about the whole day"},
        "palette": {"type": "array", "items": {"type": "string"}, "description": "3 hex colours that recur in the photos"},
    }}

WRITE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "verses", "refrain", "last_line", "mode", "bpm", "meter", "palette", "liner"],
    "properties": {
        "title": {"type": "string"},
        "verses": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["photo", "text", "contour", "chords"],
            "properties": {
                "photo": {"type": "integer"},
                "text": {"type": "string"},
                "contour": {"type": "string", "enum": CONTOURS},
                "chords": {"type": "array", "items": {"type": "string"}},
            }}},
        "refrain": {"type": "string"},
        "last_line": {"type": "string"},
        "mode": {"type": "string", "enum": ["major", "minor"]},
        "bpm": {"type": "integer"},
        "meter": {"type": "integer", "enum": [3]},
        "palette": {"type": "string", "enum": ["musicbox", "felt-piano", "guitar"]},
        "liner": {"type": "string"},
    }}

LOOK_PROMPT = """You are the eyes of Songbird, a toy cassette deck that turns photos of a child's day into a bedtime song.
Here are {n} photos from one day, numbered 0 to {last} in the order given.
For each photo pick its hero: the one concrete thing a small child would point at (an animal, a toy, food, an object),
named as a short noun phrase a segmentation model can find. Never a face or a whole person; if people are the subject,
pick the thing they hold or touch. Note what is happening and three small, specific, sensory details.
Then order the photos the way the day most likely happened (light, clothes, wet hair, lamps, pyjamas are clues)."""

WRITE_PROMPT = """You are the songwriter inside Songbird, a toy cassette deck. Write a short, true bedtime song about this day,
for {who}. The parent loaded these photos; here is what you saw in them, in the order of the day:

{photos}

The whole day: {day}
{note}
Rules, all of them matter because a machine will sing this exactly as written:
- One verse line per photo, in the order above ({n} lines). Each verse line is about its photo and must name its hero
  or one of its details by name (e.g. "the snail", "floury hands"). Specific beats generic: no "fun", "magic", "memories".
- Every verse line has 7 to 9 syllables (8 is ideal), natural iambic stress (da-DUM da-DUM da-DUM da-DUM).
- Verse lines come in couplets: lines 1-2 rhyme, 3-4 rhyme, 5-6 rhyme (a single last line need not rhyme).
- refrain: one gentle line, 7 to 9 syllables, sung after every couplet{name_rule}. Simple words, sleepy, sayable by a toddler.
- last_line: the song's final line, 7 to 10 syllables, sung once at the very end; it lands the day softly.
- Only real, common English words (no made-up words, no numerals, no abbreviations). Lowercase except names.
- Speak to the child as "you", but vary how lines open: at most half the verse lines may start with "you"; let the
  snail, the rain or the dog be the subject sometimes. Warm, a little funny, never saccharine. A small surprise or
  a tender joke in at least one line (the dog "on the night shift", the snail "who took the long way home").
- Craft: write like the best picture-book poets (Margaret Wise Brown, Julia Donaldson). Every line is a complete,
  natural sentence or clause with its articles ("the duck", not "duck"); no telegraphic word-salad, no forced
  inversions, no comma-spliced fragments. Each couplet uses a DIFFERENT rhyme sound, on two different words.
  At most one colour word per line; a verb that shows what the child did beats a list of adjectives. Prefer one vivid verb per line. Read it aloud in your head.
  Example of the bar (do not reuse): "you rolled the dough with floury hands / and sang it songs about the sands".
- title: 2 to 5 words, lowercase, drawn from the day's details (e.g. "the snail and the sprinkler").
- For each verse choose a melodic contour (rise for things going up or getting brighter, fall for settling down, arch,
  valley, steady) and 4 chords as roman numerals, one per bar ({chord_rule}).
- mode: major unless the day was mostly grey or rainy. bpm 80-100 (slower for a quiet day, it is a waltz: meter 3).
  palette: musicbox, felt-piano or guitar, whatever suits the day.
- liner: one or two sentences of liner notes in the deck's voice, lowercase, dry and warm, about this day."""


def look(photos: list[Image.Image]) -> dict:
    content = [{"type": "text", "text": LOOK_PROMPT.format(n=len(photos), last=len(photos) - 1)}]
    for i, im in enumerate(photos):
        content.append({"type": "text", "text": f"photo {i}:"})
        content.append({"type": "image_url", "image_url": {"url": meta.data_url(im, max_side=896)}})
    out = meta.spark_json([{"role": "user", "content": content}], LOOK_SCHEMA, "look", effort="low")
    n = len(photos)
    by = {p["index"]: p for p in out["photos"] if 0 <= p["index"] < n}
    for i in range(n):  # never trust the count blindly
        by.setdefault(i, {"index": i, "hero": "toy", "hero_alt": "object", "seen": "a small moment", "details": [],
                          "time_of_day": "afternoon", "mood": "tender"})
        by[i]["mood"] = by[i]["mood"] if by[i]["mood"] in MOODS else "tender"
    order = [i for i in out.get("order", []) if i in by]
    order = list(dict.fromkeys(order)) + [i for i in range(n) if i not in order]
    out["photos"] = [by[i] for i in range(n)]
    out["order"] = order
    return out


def problems(song: dict, seen: list[dict], name: str | None) -> list[str]:
    """Everything we can check mechanically. Indexes in `seen` are song order."""
    out = []
    vs = song["verses"]
    if len(vs) != len(seen):
        out.append(f"there must be exactly {len(seen)} verse lines, one per photo, you wrote {len(vs)}")
    for i, v in enumerate(vs):
        n = compose.count_syllables(v["text"])
        if not 7 <= n <= 9:
            out.append(f'verse {i + 1} "{v["text"]}" has {n} syllables, it needs 7 to 9')
        if i < len(seen):
            words = set(re.findall(r"[a-z]+", v["text"].lower()))
            p = seen[i]
            keys = set(re.findall(r"[a-z]+", (p["hero"] + " " + p["hero_alt"] + " " + " ".join(p["details"])).lower()))
            keys -= compose.FUNCTION_WORDS | {"small", "little", "tiny", "big", "very"}
            if not words & keys:
                out.append(f'verse {i + 1} "{v["text"]}" does not name anything from its photo ({p["hero"]}: {", ".join(p["details"])})')
    for i in range(0, len(vs) - 1, 2):
        if _last(vs[i]["text"]).lower() == _last(vs[i + 1]["text"]).lower():
            out.append(f'verses {i + 1} and {i + 2} end on the same word "{_last(vs[i]["text"])}", rhyme two different words')
        elif not compose.rhymes(vs[i]["text"], vs[i + 1]["text"]):
            out.append(f'verses {i + 1} and {i + 2} should rhyme ("{_last(vs[i]["text"])}" / "{_last(vs[i + 1]["text"])}")')
    for key, lo, hi in (("refrain", 6, 9), ("last_line", 6, 10)):
        n = compose.count_syllables(song[key])
        if not lo <= n <= hi:
            out.append(f'{key} "{song[key]}" has {n} syllables, it needs {lo} to {hi}')
    if name and name.lower() not in song["refrain"].lower():
        out.append(f'the refrain should say the name "{name}"')
    return out


def _last(t: str) -> str:
    ws = compose.words_of(t)
    return ws[-1] if ws else ""


def write(look_out: dict, name: str | None = None, note: str | None = None, rounds: int = 3,
          on_try=None, model: str | None = None, effort: str = "high") -> dict:
    order = look_out["order"]
    seen = [look_out["photos"][i] for i in order]
    lines = "\n".join(f"{k + 1}. (photo {i}) hero: {p['hero']}. {p['seen']}. details: {'; '.join(p['details'])}. "
                      f"{p['time_of_day']}, {p['mood']}." for k, (i, p) in enumerate(zip(order, seen)))
    prompt = WRITE_PROMPT.format(
        who=f"a child called {name}" if name else "a small child",
        photos=lines, day=look_out.get("day", ""), n=len(seen),
        note=f"The parent added a note: \"{note}\"\n" if note else "",
        name_rule=f' and must include the name "{name}"' if name else "",
        chord_rule="major keys: I ii iii IV V vi; minor keys: i III iv v VI VII V")
    messages = [{"role": "user", "content": prompt}]
    best, best_n = None, 1e9
    for r in range(rounds):
        song = meta.spark_json(messages, WRITE_SCHEMA, "song", effort=effort, model=model)
        for k, v in enumerate(song["verses"]):  # photo index follows song order
            v["photo"] = order[k] if k < len(order) else v.get("photo")
        issues = problems(song, seen, name)
        if on_try:
            on_try(r, song, issues)
        if len(issues) < best_n:
            best, best_n = song, len(issues)
        if not issues:
            break
        messages += [{"role": "assistant", "content": json.dumps(song)},
                     {"role": "user", "content": "Our singing machine checked it and found these problems. Fix only what is "
                                                 "listed, keep everything else, return the whole song again:\n- " + "\n- ".join(issues)}]
    best["issues"] = problems(best, seen, name)
    return best


def plan_lines(song: dict) -> list[compose.PlannedLine]:
    """Song order: couplets of verses, the refrain after each couplet, the last line to close."""
    vs = song["verses"]
    out = []
    moods = song.get("_moods", {})
    for i, v in enumerate(vs):
        out.append(compose.PlannedLine(v["text"], "verse", v["photo"], v["contour"], moods.get(v["photo"], "tender"), v["chords"]))
        if i % 2 == 1 and i < len(vs) - 1:
            out.append(compose.PlannedLine(song["refrain"], "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]))
    out.append(compose.PlannedLine(song["refrain"], "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]))
    out.append(compose.PlannedLine(song["last_line"], "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]))
    return out
