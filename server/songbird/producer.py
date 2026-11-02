"""The producer: a small bird with enormous opinions.

write()   Muse Wonder writes the single: picks the genre with conviction, casts the day's objects as the band,
          writes lyrics where every verse line belongs to a photo, and the liner notes. Checked mechanically and
          sent back until it holds up.
listen()  Muse Spark 1.2 listens to a finished take (audio in) and scores it like an A&R session: is the voice
          natural, can you hear the words, does it sound like the genre we asked for.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess

from . import compose, meta

PRODUCE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "genre", "why", "caption", "bpm", "key", "vocal", "sections", "band", "liner"],
    "properties": {
        "title": {"type": "string"},
        "genre": {"type": "string", "description": "the genre in a few words, with an era, e.g. '1974 philly soul ballad'"},
        "why": {"type": "string", "description": "one sentence: why this day could only ever have been this genre"},
        "caption": {"type": "string", "description": "production notes for the recording session: era, instruments, vocal type and delivery, mix, tempo feel. 20-45 words, comma separated"},
        "bpm": {"type": "integer"},
        "key": {"type": "string", "description": "e.g. 'F major', 'A minor'"},
        "vocal": {"type": "string", "enum": ["female", "male"]},
        "sections": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["tag", "lines"],
            "properties": {
                "tag": {"type": "string", "enum": ["Intro", "Verse 1", "Verse 2", "Verse 3", "Pre-Chorus", "Chorus", "Bridge", "Outro"]},
                "lines": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False, "required": ["text", "photo"],
                    "properties": {"text": {"type": "string"},
                                   "photo": {"type": ["integer", "null"], "description": "the photo this line is about, or null"}}}}}}},
        "band": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["photo", "role"],
            "properties": {"photo": {"type": "integer"},
                           "role": {"type": "string", "description": "the credit, e.g. 'lead vocals', 'bass', 'tambourine', 'emotional support'"}}}},
        "liner": {"type": "string"},
    }}

PRODUCE_PROMPT = """You are the producer inside Songbird: a small wooden bird who runs a record label for one family, and takes
small days extremely seriously. Every day gets released as a single. Today's photos came in{who}; this is what the
deck saw, in the order of the day:

{photos}

The whole day: {day}
{note}
Make the single. Rules, every one matters:
- Pick the genre with total conviction, the way a genius producer would: specific, with an era, and surprising but
  RIGHT for this day (a goose ambush is 1974 soul heartbreak; a rainy car ride is 1983 synth-pop; a bath is surf rock;
  a birthday is a stadium anthem). Never "lullaby", never generic "pop" or "acoustic". The bigger the gap between how
  small the day was and how seriously the genre treats it, the better, as long as it is warm, never mean.
- caption: production notes the session band will read: era, specific instruments, vocal type and delivery, mix.
  The vocal must be a clear, full, confident lead voice, upfront in the mix (never breathy or whispered).
- Lyrics: a real song structure: Verse 1, Chorus, Verse 2, Chorus, Bridge or Verse 3 (optional), Chorus. 4 lines per
  verse, 2 to 4 lines per chorus (the chorus repeats word for word). 16 to 22 lines in total.
- Every photo must be sung about by name in at least one verse line, and that line's "photo" is its index. Hyper
  specific beats generic: name the object, the colour, the exact thing that happened. No "magic", "memories",
  "adventure", "journey", "special", "fun". Chorus lines have photo null.
- Lines 5 to 10 syllables, natural stress, real rhymes (verse lines 2 and 4 rhyme at least). Lowercase except names.
  Say it in the genre's own idiom (soul: "baby", "oh"; punk: shouted, short).
- The chorus is the hook: short, singable, a little absurd, sincere. If the child has a name, the chorus uses it.
- band: cast every photo's hero as a band member with a credit ("the goose: lead antagonist", "the band-aid:
  tambourine"). Funny and affectionate.
- title: the single's title, 1 to 5 words, lowercase, like a real song title.
- liner: 2 or 3 sentences of liner notes in your voice: lowercase, dry, opinionated, warm, a bit unhinged about
  how much this day mattered. No emoji. No "AI".
- bpm and key that suit the genre."""

BANNED = {"magic", "magical", "memories", "memory", "adventure", "adventures", "journey", "special", "fun"}


def problems(song: dict, n_photos: int) -> list[str]:
    out = []
    lines = [ln for s in song["sections"] for ln in s["lines"]]
    if not 14 <= len(lines) <= 24:
        out.append(f"the song has {len(lines)} lines, it needs 16 to 22")
    covered = {ln["photo"] for ln in lines if ln.get("photo") is not None}
    missing = [i for i in range(n_photos) if i not in covered]
    if missing:
        out.append("these photos are never sung about (set a verse line's photo to them): " + ", ".join(map(str, missing)))
    tags = [s["tag"] for s in song["sections"]]
    if tags.count("Chorus") < 2:
        out.append("the chorus must come back at least twice")
    choruses = [tuple(l["text"].strip().lower() for l in s["lines"]) for s in song["sections"] if s["tag"] == "Chorus"]
    if len(set(choruses)) > 1:
        out.append("every chorus must repeat the first chorus word for word")
    for ln in lines:
        n = compose.count_syllables(ln["text"])
        if n > 12:
            out.append(f'"{ln["text"]}" is {n} syllables, too long to sing; 5 to 10')
        bad = BANNED & set(re.findall(r"[a-z]+", ln["text"].lower()))
        if bad:
            out.append(f'"{ln["text"]}" uses a banned word ({", ".join(bad)})')
    if not 50 <= int(song.get("bpm", 0)) <= 180:
        out.append("bpm must be 50 to 180")
    if "lullaby" in song["genre"].lower():
        out.append("no lullabies")
    return out


def write(look: dict, order: list[int], name: str | None, note: str | None, on_try=None, rounds: int = 3,
          model: str = "muse-wonder-1.0") -> dict:
    """Photo indexes in the output are song positions (0..n-1 following `order`)."""
    seen = [look["photos"][i] for i in order]
    photos = "\n".join(f"{k}. hero: {p['hero']}. {p['seen']}. details: {'; '.join(p['details'])}. {p['time_of_day']}."
                       for k, p in enumerate(seen))
    prompt = PRODUCE_PROMPT.format(
        who=f" for {name}" if name else "", photos=photos, day=look.get("day", ""),
        note=f'The parent added: "{note}" (use it, it matters more than anything in the photos).\n' if note else "")
    messages = [{"role": "user", "content": prompt}]
    best, best_n = None, 1e9
    for r in range(rounds):
        song = meta.spark_json(messages, PRODUCE_SCHEMA, "single", effort="high", model=model)
        issues = problems(song, len(seen))
        if on_try:
            on_try(r, song, issues)
        if len(issues) < best_n:
            best, best_n = song, len(issues)
        if not issues:
            break
        messages += [{"role": "assistant", "content": json.dumps(song)},
                     {"role": "user", "content": "The label's checker found these problems. Fix only these, keep the rest, "
                                                 "return the whole single again:\n- " + "\n- ".join(issues)}]
    best["issues"] = problems(best, len(seen))
    return best


def lyrics_text(song: dict) -> str:
    """ACE-Step lyric sheet: [Section] headers, one sung line per row."""
    out = []
    for s in song["sections"]:
        out.append(f"[{s['tag']}]")
        out.extend(ln["text"] for ln in s["lines"])
        out.append("")
    return "\n".join(out).strip()


LISTEN_PROMPT = """You are a blunt A&R producer in a listening session. This take was meant to be: {genre}.
The lyric sheet starts:
{lyrics}

Listen to the take. Answer in exactly this format, nothing else:
VOICE: <0-10, how natural and pleasant the lead singer sounds; 10 = a great human singer, 0 = robotic or creepy>
WORDS: <0-10, how clearly the sung words come through>
GENRE: <0-10, how convincingly it is the genre asked for>
HEARD: <the first sung line exactly as you hear it>
VERDICT: <one blunt, funny sentence, like a producer in the control room, lowercase>"""


def listen(audio_path: str, genre: str, lyrics: str, seconds: int = 45) -> dict:
    """Muse Spark 1.2 listens to the first `seconds` of a take and scores it (audio in, plain text out)."""
    wav = subprocess.run(["ffmpeg", "-v", "error", "-i", audio_path, "-t", str(seconds), "-ac", "1", "-ar", "16000",
                          "-f", "wav", "-"], capture_output=True, check=True).stdout
    content = [{"type": "text", "text": LISTEN_PROMPT.format(genre=genre, lyrics=lyrics[:300])},
               {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}}]
    j = meta._post("/chat/completions", {"model": "muse-spark-1.2", "messages": [{"role": "user", "content": content}]})
    text = j["choices"][0]["message"]["content"] or ""
    out = {}
    for key in ("voice", "words", "genre"):
        m = re.search(rf"{key.upper()}\s*:\s*(\d+(?:\.\d+)?)", text)
        out[key] = max(0.0, min(10.0, float(m.group(1)))) if m else 5.0
    for key in ("heard", "verdict"):
        m = re.search(rf"{key.upper()}\s*:\s*(.+)", text)
        out[key] = m.group(1).strip().strip('"') if m else ""
    out["score"] = round(0.45 * out["voice"] + 0.35 * out["words"] + 0.2 * out["genre"], 2)
    out["raw"] = text[:600]
    return out
