"""The composer: turns a written song (lines of lyrics + a per-line musical plan) into a singable score.

  lyrics ──► syllables with stress (CMUdict, g2p fallback)
         ──► rhythm: each syllable placed on the bar grid so stressed syllables land on strong beats (DP)
         ──► melody: pitches over the line's chords, following the contour the writer asked for (DP)
         ──► comp (for the arranger), SoulX-Singer segments (one per line), and line/word timings

Every line is 4 bars. The song is: intro (2 bars), the lines in order, outro (4 bars).
A line may start with pickup syllables in the last beat of the bar before it.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from functools import lru_cache

import cmudict

# ---------------------------------------------------------------- pronunciation

_CMU = cmudict.dict()
_G2P = None

FUNCTION_WORDS = set("""
a an the and or but nor so yet of to in on at by for with from into onto upon off up as than then
is was are were be been am do did does has had have will would can could shall should may might must
i me my mine you your yours he him his she her hers it its we us our ours they them their theirs
this that these those there here who whom whose which what when where while if not no
all just too very
""".split())

LEGAL_ONSETS = {tuple(x.split()) for x in """
P R|T R|K R|B R|D R|G R|F R|TH R|SH R|P L|K L|B L|G L|F L|S L|S P|S T|S K|S M|S N|S W|T W|D W|K W|G W|TH W
S P R|S T R|S K R|S P L|S K W|P Y|B Y|F Y|M Y|K Y|HH Y|V Y|HH W|S K Y|S P Y|N Y|L Y|D Y|T Y|G Y
""".replace("\n", "").split("|") if x.strip()}

VOWEL = re.compile(r"^[A-Z]+[012]$")


def _g2p(word: str) -> list[str]:
    global _G2P
    if _G2P is None:
        from g2p_en import G2p
        _G2P = G2p()
    return [p for p in _G2P.predict(word) if re.match(r"^[A-Z]+[012]?$", p)]


@lru_cache(maxsize=4096)
def phones(word: str) -> tuple[str, ...]:
    w = word.lower().strip("'")
    if w in _CMU:
        return tuple(_CMU[w][0])
    if w.endswith("'s") and w[:-2] in _CMU:
        return tuple(_CMU[w[:-2]][0] + ["Z"])
    parts = [p for p in re.split(r"[-']", w) if p]
    if len(parts) > 1 and all(p in _CMU for p in parts):
        return tuple(x for p in parts for x in _CMU[p][0])
    return tuple(_g2p(w))


@dataclass
class Syllable:
    word: int            # index of the word in its line
    phones: list[str]
    stress: int          # 0 weak, 1 secondary, 2 primary
    text: str            # orthographic-ish piece, for display
    last_in_word: bool = False


def syllabify(word: str, widx: int) -> list[Syllable]:
    ph = list(phones(word))
    nuclei = [i for i, p in enumerate(ph) if VOWEL.match(p)]
    if not nuclei:  # e.g. "hmm": sing it as one weak syllable on a neutral vowel
        return [Syllable(widx, ph + ["AH0"] if ph else ["AH0"], 0, word, True)]
    bounds = [0]
    for a, b in zip(nuclei, nuclei[1:]):
        cluster = ph[a + 1:b]
        k = len(cluster)
        for j in range(len(cluster) + 1):
            onset = tuple(cluster[j:])
            if not onset or (len(onset) == 1 and onset[0] != "NG") or onset in LEGAL_ONSETS:
                k = j
                break
        bounds.append(a + 1 + k)
    bounds.append(len(ph))
    sylls = []
    pieces = _split_letters(word, len(nuclei))
    mono = len(nuclei) == 1
    for i, n in enumerate(nuclei):
        seg = ph[bounds[i]:bounds[i + 1]]
        digit = ph[n][-1]
        if mono:
            stress = 0 if word.lower().strip("'") in FUNCTION_WORDS else 2
        else:
            stress = {"1": 2, "2": 1, "0": 0}[digit]
        sylls.append(Syllable(widx, seg, stress, pieces[i]))
    sylls[-1].last_in_word = True
    return sylls


def _split_letters(word: str, n: int) -> list[str]:
    if n <= 1:
        return [word]
    groups = [m.start() for m in re.finditer(r"[aeiouy]+", word.lower())]
    if len(groups) < n:
        step = max(1, len(word) // n)
        cuts = [step * i for i in range(1, n)]
    else:
        cuts = []
        for g in groups[1:n]:
            c = g
            while c - 1 > 0 and word[c - 1].lower() not in "aeiouy" and c - 1 > (cuts[-1] if cuts else 0):
                c -= 1
                break
            cuts.append(c)
    out, prev = [], 0
    for c in cuts + [len(word)]:
        out.append(word[prev:c])
        prev = c
    return [o if o else "-" for o in out]


def words_of(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'\-]*", text)


def line_syllables(text: str) -> list[Syllable]:
    out = []
    for i, w in enumerate(words_of(text)):
        out.extend(syllabify(w, i))
    return out


def count_syllables(text: str) -> int:
    return len(line_syllables(text))


def rhyme_key(text: str) -> tuple[str, ...]:
    """Phones from the last stressed vowel of the line to the end, stress digits dropped."""
    ws = words_of(text)
    if not ws:
        return ()
    ph = list(phones(ws[-1]))
    idx = [i for i, p in enumerate(ph) if VOWEL.match(p) and p[-1] in "12"] or [i for i, p in enumerate(ph) if VOWEL.match(p)]
    if not idx:
        return tuple(ph)
    return tuple(re.sub(r"\d", "", p) for p in ph[idx[-1]:])


def rhymes(a: str, b: str) -> bool:
    ka, kb = rhyme_key(a), rhyme_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    # slant rhyme: same vowel, codas share their last consonant class
    return ka[0] == kb[0] and (len(ka) == 1) == (len(kb) == 1)


# ---------------------------------------------------------------- harmony

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
ROMAN = {"i": 0, "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5, "vii": 6}
NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

MAJOR_PROGS = [["I", "IV", "V", "I"], ["I", "vi", "IV", "V"], ["vi", "IV", "I", "V"], ["I", "V", "vi", "IV"],
               ["IV", "I", "ii", "V"], ["I", "iii", "IV", "I"], ["ii", "V", "I", "I"], ["IV", "V", "I", "I"]]
MINOR_PROGS = [["i", "VI", "III", "VII"], ["i", "iv", "VII", "III"], ["VI", "VII", "i", "i"], ["i", "VII", "VI", "V"],
               ["iv", "i", "V", "i"], ["i", "III", "iv", "V"]]


def chord_of(roman: str, tonic: int, mode: str) -> dict:
    """Roman numeral → {'chord': name, 'tones': [root, third, fifth] around octave 3, 'pcs': set}."""
    r = roman.strip()
    seventh = r.endswith("7")
    r = r.rstrip("7")
    deg = ROMAN.get(r.lower())
    if deg is None:
        deg, r = 0, "I"
    scale = MAJOR if mode == "major" else MINOR
    root_pc = (tonic + scale[deg]) % 12
    if mode == "minor" and r == "V":          # harmonic minor dominant
        quality = "maj"
    else:
        quality = "maj" if r.isupper() else "min"
    if r.lower() == "vii" and r.islower():
        quality = "dim"
    third = 4 if quality == "maj" else 3
    fifth = 6 if quality == "dim" else 7
    root = 48 + root_pc
    if root > 55:
        root -= 12
    tones = [root, root + third, root + fifth] + ([root + (10 if quality != "maj" or r == "V" else 11)] if seventh else [])
    name = NOTE_NAMES[root_pc] + {"maj": "", "min": "m", "dim": "dim"}[quality] + ("7" if seventh else "")
    return {"chord": name, "tones": tones, "pcs": {t % 12 for t in tones}, "roman": roman}


def key_name(tonic: int, mode: str) -> str:
    return f"{NOTE_NAMES[tonic % 12]} {mode}"


# ---------------------------------------------------------------- rhythm

def metric_weight(beat: float, meter: int) -> float:
    """Strength of a position measured in beats from the line's first downbeat."""
    pos = beat % meter
    if abs(pos) < 1e-6:
        return 3.0
    if meter == 4 and abs(pos - 2) < 1e-6:
        return 2.0
    if abs(pos - round(pos)) < 1e-6:
        return 1.0
    return 0.0


def place_rhythm(sylls: list[Syllable], meter: int, bars: int = 4) -> list[tuple[float, float]]:
    """Choose (onset, duration) in beats for every syllable of one line.

    Onsets live on an eighth-note grid in [-pickup, end). Stressed syllables want strong beats, weak ones want
    weak beats, the last syllable must start on a downbeat in the last two bars and is held to the end of the
    line (minus a breath). Solved exactly by DP over (syllable, onset).
    """
    n = len(sylls)
    step = 0.5
    total = bars * meter
    breath = 0.5
    pickup = 1.0 if meter == 3 else 2.0
    grid = [x * step for x in range(int(-pickup / step), int((total - breath) / step))]
    last_ok = [g for g in grid if metric_weight(g, meter) >= 2.0 and g >= (bars - 2) * meter]
    # final syllable: prefer the last downbeat when the line is long, the third bar when short
    INF = float("inf")

    def place_cost(s: Syllable, g: float) -> float:
        w = metric_weight(g, meter)
        if s.stress == 2:
            c = (3 - w) * 2.0
        elif s.stress == 1:
            c = abs(2 - w) * 0.8
        else:
            c = {3.0: 4.5, 2.0: 2.0, 1.0: 0.4, 0.0: 0.0}[w]
        if w == 0.0:
            c += 2.2  # offbeat eighths: allowed, but a lullaby walks on the beat
        if g < 0 and s.stress == 2:
            c += 3.0  # don't put the line's first strong syllable in the pickup
        return c

    def dur_cost(s: Syllable, d: float, nxt: Syllable | None) -> float:
        if d < step - 1e-9:
            return INF
        c = 0.0
        if d == 0.5:
            c += 0.9 if s.stress == 2 else 0.25
        if d > 3:
            c += (d - 3) * 1.2
        if s.stress == 2 and d < 1:
            c += 0.6
        if s.stress == 0 and d > 1.5:
            c += (d - 1.5) * 0.9
        # word-internal gaps hurt more than gaps between words
        if not s.last_in_word and d > 2:
            c += (d - 2) * 1.5
        return c

    # dp[i][j] = best cost with syllable i at grid[j]
    dp = [[INF] * len(grid) for _ in range(n)]
    back = [[-1] * len(grid) for _ in range(n)]
    for j, g in enumerate(grid):
        if g <= 0:  # first syllable starts in the pickup or on the first downbeat
            dp[0][j] = place_cost(sylls[0], g) + (0 if g == 0 or sylls[0].stress < 2 else 2.0)
    for i in range(1, n):
        for j, g in enumerate(grid):
            if i == n - 1 and g not in last_ok:
                continue
            pc = place_cost(sylls[i], g)
            best, arg = INF, -1
            for k in range(j):
                if dp[i - 1][k] == INF:
                    continue
                d = g - grid[k]
                c = dp[i - 1][k] + dur_cost(sylls[i - 1], d, sylls[i])
                if c < best:
                    best, arg = c, k
            if arg >= 0:
                dp[i][j] = best + pc
                back[i][j] = arg
    end = total - breath
    j_best, c_best = -1, INF
    for j, g in enumerate(grid):
        if dp[n - 1][j] == INF:
            continue
        d = end - g
        c = dp[n - 1][j] + (0 if d >= 2 else 2.5) + (0.0 if g >= (bars - 1) * meter else 0.8)
        if c < c_best:
            j_best, c_best = j, c
    if j_best < 0:
        raise ValueError(f"line does not fit in {bars} bars of {meter}: {n} syllables")
    onsets = [0.0] * n
    j = j_best
    for i in range(n - 1, -1, -1):
        onsets[i] = grid[j]
        j = back[i][j]
    out = []
    for i in range(n):
        d = (onsets[i + 1] if i + 1 < n else end) - onsets[i]
        out.append((onsets[i], d))
    return out


# ---------------------------------------------------------------- melody

CONTOURS = {
    "rise": lambda t: -0.8 + 1.6 * t,
    "fall": lambda t: 0.8 - 1.6 * t,
    "arch": lambda t: -0.6 + 1.6 * math.sin(math.pi * t),
    "valley": lambda t: 0.6 - 1.4 * math.sin(math.pi * t),
    "steady": lambda t: 0.1 * math.sin(2 * math.pi * t),
}


def scale_pitches(tonic: int, mode: str, lo: int, hi: int) -> list[int]:
    sc = MAJOR if mode == "major" else MINOR
    pcs = {(tonic + s) % 12 for s in sc}
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def write_melody(rhythm: list[tuple[float, float]], sylls: list[Syllable], chords: list[dict], meter: int,
                 tonic: int, mode: str, contour: str, center: int, span: int, end_on: str,
                 prev_last: int | None) -> list[int]:
    """Pick a pitch per syllable: chord tones on strong syllables, stepwise motion, follow the contour.

    end_on: 'tonic' (song end), 'stable' (chord root/third), or 'open' (fifth / leading, a half cadence feel).
    """
    lo, hi = center - span, center + span
    cands = scale_pitches(tonic, mode, lo, hi)
    if mode == "minor":  # allow the raised leading tone over V
        cands = sorted(set(cands + [p for p in range(lo, hi + 1) if p % 12 == (tonic + 11) % 12]))
    fn = CONTOURS.get(contour, CONTOURS["arch"])
    n = len(rhythm)
    t0, t1 = rhythm[0][0], rhythm[-1][0]
    INF = float("inf")

    def chord_at(beat: float) -> dict:
        bar = int(max(0, beat) // meter)
        return chords[min(bar, len(chords) - 1)]

    def unary(i: int, p: int) -> float:
        on, d = rhythm[i]
        ch = chord_at(on)
        w = metric_weight(on, meter)
        t = (on - t0) / max(1e-6, (t1 - t0))
        target = center + fn(t) * span * 0.75
        c = abs(p - target) * 0.35
        is_ct = p % 12 in ch["pcs"]
        strong = sylls[i].stress == 2 or w >= 2 or d >= 2
        if strong and not is_ct:
            c += 3.0
        if not strong and not is_ct:
            c += 0.4
        if mode == "minor" and p % 12 == (tonic + 11) % 12 and "V" not in ch["roman"]:
            c += 4.0
        if i == n - 1:
            if end_on == "tonic":
                c += 0 if p % 12 == tonic % 12 else 8.0
            elif end_on == "stable":
                c += 0 if p % 12 in (ch["tones"][0] % 12, ch["tones"][1] % 12) else 2.5
            else:
                c += 0 if p % 12 == ch["tones"][2] % 12 or p % 12 == ch["tones"][0] % 12 else 1.5
        if i == 0 and prev_last is not None:
            c += max(0, abs(p - prev_last) - 5) * 0.6
        return c

    def pair(a: int, b: int, i: int) -> float:
        leap = abs(b - a)
        c = 0.0
        if leap == 0:
            c += 0.6
        elif leap <= 2:
            c += 0.0
        elif leap <= 4:
            c += 0.5
        elif leap <= 7:
            c += 1.6
        else:
            c += 4.0 + (leap - 7)
        # same word melisma-free syllables: keep them close
        if not sylls[i - 1].last_in_word and leap > 4:
            c += 1.0
        return c

    dp = [[INF] * len(cands) for _ in range(n)]
    back = [[-1] * len(cands) for _ in range(n)]
    for j, p in enumerate(cands):
        dp[0][j] = unary(0, p)
    for i in range(1, n):
        for j, p in enumerate(cands):
            u = unary(i, p)
            best, arg = INF, -1
            for k, q in enumerate(cands):
                c = dp[i - 1][k] + pair(q, p, i)
                # after a leap, step back the other way
                if i >= 2 and back[i - 1][k] >= 0:
                    r = cands[back[i - 1][k]]
                    if abs(q - r) >= 5 and (p - q) * (q - r) > 0:
                        c += 1.2
                if c < best:
                    best, arg = c, k
            dp[i][j] = best + u
            back[i][j] = arg
    j = min(range(len(cands)), key=lambda k: dp[n - 1][k])
    out = [0] * n
    for i in range(n - 1, -1, -1):
        out[i] = cands[j]
        j = back[i][j]
    return out


# ---------------------------------------------------------------- the song

@dataclass
class PlannedLine:
    text: str
    kind: str = "verse"           # verse | refrain
    photo: int | None = None
    contour: str = "arch"
    mood: str = "tender"
    chords: list[str] = field(default_factory=list)


def compose(lines: list[PlannedLine], *, tonic: int = 65, mode: str = "major", bpm: int = 92, meter: int = 3,
            palette: str = "musicbox", energy: float = 0.35, brightness: float = 0.5,
            intro_bars: int = 3, outro_bars: int = 4, center: int = 67, span: int = 7) -> dict:
    """Compose the whole song. Returns {'comp', 'segments', 'lines', 'duration'}.

    Lines with identical text (the refrain) reuse the first take's rhythm and melody, so the song repeats like
    a song should.
    """
    beat_s = 60.0 / bpm
    bar_beats = meter
    line_bars = 4 if meter == 3 else 2   # four stresses per line: four waltz bars, or two bars of 4/4
    progs = MAJOR_PROGS if mode == "major" else MINOR_PROGS
    memo: dict[str, tuple] = {}
    bars, sections, melody, segs, timed = [], [], [], [], []
    line_notes: list[list[dict]] = []

    for _ in range(intro_bars):
        bars.append(None)
    sections.append({"kind": "intro", "bar": 0, "bars": intro_bars, "mood": lines[0].mood if lines else "tender"})

    prev_last = None
    for li, ln in enumerate(lines):
        start_bar = intro_bars + li * line_bars
        romans = [r for r in (ln.chords or []) if r.strip().rstrip("7").lower() in ROMAN][:line_bars]
        if len(romans) < line_bars:
            romans = progs[li % len(progs)]
        is_last = li == len(lines) - 1
        if is_last:  # land the song home
            romans = romans[:2] + (["V", "I"] if mode == "major" else ["V", "i"])
        if line_bars == 2:
            romans = [romans[0], romans[-1] if romans[-1] != romans[0] else romans[2]]
        chords = [chord_of(r, tonic, mode) for r in romans]
        key = ln.text.strip().lower()
        sylls = line_syllables(ln.text)
        if not sylls:
            raise ValueError(f"empty line {li}")
        if key in memo and not is_last:
            rhythm, pitches, chords = memo[key]
        else:
            rhythm = place_rhythm(sylls, meter, line_bars)
            nxt = lines[li + 1] if li + 1 < len(lines) else None
            end_on = "tonic" if is_last else ("open" if nxt is not None and nxt.kind == ln.kind == "verse" and li % 2 == 0 else "stable")
            pitches = write_melody(rhythm, sylls, chords, meter, tonic, mode, ln.contour, center, span, end_on, prev_last)
            memo.setdefault(key, (rhythm, pitches, chords))
        prev_last = pitches[-1]
        for c in chords:
            bars.append({"chord": c["chord"], "tones": c["tones"], "roman": c["roman"]})
        sections.append({"kind": ln.kind, "bar": start_bar, "bars": line_bars, "mood": ln.mood, "photo": ln.photo})

        line_beat0 = start_bar * bar_beats
        line_notes.append([{"beat": line_beat0 + on, "dur": d, "midi": p, "syl": s}
                           for (on, d), p, s in zip(rhythm, pitches, sylls)])

    # a pickup into the next line steals the end of this line's held note, plus a breath
    for i in range(len(line_notes) - 1):
        last, nxt = line_notes[i][-1], line_notes[i + 1][0]
        if last["beat"] + last["dur"] > nxt["beat"] - 0.25:
            last["dur"] = max(0.5, nxt["beat"] - 0.25 - last["beat"])
    for li, (ln, notes) in enumerate(zip(lines, line_notes)):
        melody.extend({"beat": n["beat"], "dur": n["dur"], "midi": n["midi"]} for n in notes)
        segs.append(_segment(li, notes, beat_s))
        timed.append({"text": ln.text, "kind": ln.kind, "photo": ln.photo,
                      "start": round(notes[0]["beat"] * beat_s, 3),
                      "end": round((notes[-1]["beat"] + notes[-1]["dur"]) * beat_s, 3),
                      "words": _word_times(ln.text, notes, beat_s)})

    out_bar = intro_bars + len(lines) * line_bars
    home = chord_of("I" if mode == "major" else "i", tonic, mode)
    four = chord_of("IV" if mode == "major" else "iv", tonic, mode)
    for r in [home, four, home, home][:outro_bars]:
        bars.append({"chord": r["chord"], "tones": r["tones"], "roman": r["roman"]})
    sections.append({"kind": "outro", "bar": out_bar, "bars": outro_bars, "mood": "sleepy"})
    # intro bars carry the first line's opening harmony
    first = next(b for b in bars if b is not None)
    bars = [b if b is not None else first for b in bars]

    total_beats = len(bars) * bar_beats
    comp = {"bpm": bpm, "meter": meter, "key": {"tonic": tonic, "mode": mode}, "bars": bars,
            "sections": sections, "melody": melody,
            "style": {"energy": energy, "brightness": brightness, "palette": palette},
            "total_beats": total_beats}
    return {"comp": comp, "segments": segs, "lines": timed, "duration": round(total_beats * beat_s, 3),
            "key": key_name(tonic, mode)}


def _segment(li: int, notes: list[dict], beat_s: float, pad: float = 0.35) -> dict:
    """SoulX-Singer score-control metadata for one line, positioned at `offset` seconds in the song."""
    start = notes[0]["beat"] * beat_s - pad
    dur, ph, pitch, typ = [pad], ["<SP>"], [0], [1]
    for n in notes:
        dur.append(n["dur"] * beat_s)
        ph.append("en_" + "-".join(n["syl"].phones))
        pitch.append(n["midi"])
        typ.append(2)
    dur.append(pad)
    ph.append("<SP>"); pitch.append(0); typ.append(1)
    text = ["<SP>"] + [n["syl"].text.lower() for n in notes] + ["<SP>"]
    return {"index": f"line_{li}", "offset": round(start, 4), "language": "English",
            "time": [0, round(sum(dur) * 1000)], "duration": " ".join(f"{x:.3f}" for x in dur),
            "text": " ".join(text), "phoneme": " ".join(ph),
            "note_pitch": " ".join(map(str, pitch)), "note_type": " ".join(map(str, typ))}


def _word_times(text: str, notes: list[dict], beat_s: float) -> list[dict]:
    ws = words_of(text)
    spans: dict[int, list[float]] = {}
    for n in notes:
        w = n["syl"].word
        a, b = n["beat"] * beat_s, (n["beat"] + n["dur"]) * beat_s
        if w in spans:
            spans[w][1] = b
        else:
            spans[w] = [a, b]
    # keep the original punctuation attached to each word for display
    display = re.findall(r"[A-Za-z][A-Za-z'\-]*[^\sA-Za-z]*", text)
    out = []
    for i, w in enumerate(ws):
        a, b = spans.get(i, [0, 0])
        out.append({"text": display[i] if i < len(display) else w, "start": round(a, 3), "end": round(b, 3)})
    return out


def score_text(song: dict) -> str:
    """Human-readable score dump for debugging."""
    out = []
    for seg, ln in zip(song["segments"], song["lines"]):
        out.append(f"{ln['start']:6.2f}s  {ln['text']}")
        ph = seg["phoneme"].split()[1:-1]
        ps = seg["note_pitch"].split()[1:-1]
        ds = seg["duration"].split()[1:-1]
        out.append("         " + "  ".join(f"{p.replace('en_', '')}:{NOTE_NAMES[int(m) % 12]}{int(m) // 12 - 1}/{float(d):.2f}"
                                          for p, m, d in zip(ph, ps, ds)))
    return "\n".join(out)
