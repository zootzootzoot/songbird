"""Songbird arranger: the composer's plan -> a bedtime instrumental -> the sung vocal mixed on top -> song.mp3.

    render_instrumental(comp, sr=44100) -> float32 (n, 2)
    mix(comp, vocal, vocal_sr, out_mp3, out_wav=None) -> duration in seconds

Everything is modeled from scratch in numpy (no samples): a music-box comb (inharmonic tines), a felt piano
or a nylon guitar for the broken chords (picked by style.palette), a bowed pad, a round bass on the chord
roots, brushes and shaker when the energy is up, rain for rainy sections, and the music-box foley (wind-up
ratchet at the top, the spring running down and a soft catch at the end).

Shape of a song:
  intro    the box is wound, then plays the first sung phrase alone (root tines on the downbeats)
  verse    pad + bass + arpeggio under the voice, leaving room around the sung pitches
  refrain  a little fuller, plus a quiet music-box doubling of the melody and a "lid opens" sparkle
  outro    the box repeats the last phrase, slowing and drooping in pitch like a spring running out, then clicks
Mood per section changes the texture (pattern density, brightness, decay, colour tones, rain, sparkle).

Note sounds are cached per (pitch, brightness, decay, variant) and the pad is rendered at a quarter of the
sample rate, so a 90 s song renders in a few seconds. Output is deterministic: the RNG is seeded from the comp.
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import zlib
from math import gcd

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import butter, oaconvolve, resample_poly, sosfilt

F32 = np.float32
TAU = 2 * np.pi

BUSES = ("box", "keys", "pad", "bass", "perc", "rain", "sfx")
LEVELS = {"box": .30, "keys": .30, "pad": .10, "bass": .28, "perc": .45, "rain": .12, "sfx": .42}
SENDS = {"box": .34, "keys": .20, "pad": .30, "bass": .03, "perc": .10, "rain": .18, "sfx": .10}

INSTRUMENTAL_LUFS = -18.0
MASTER_LUFS = -16.0
TRUE_PEAK_DB = -1.5
VOCAL_OVER_BED_LU = 6.0      # vocal loudness above the accompaniment it sits on

# dens: 0 sparse, 1 quarters, 2 eighths, 3 bouncing eighths. bright: added to style.brightness.
# decay: note ring multiplier. gate: piano note length factor (playful is a little detached).
MOODS = {
    "bright":  dict(dens=2, bright=+.22, decay=1.00, pad=.85, keys=1.00, bass=1.00, sparkle=.30, rain=0., perc=+.10, wet=.90, gate=1.0),
    "playful": dict(dens=3, bright=+.28, decay=.75,  pad=.70, keys=1.00, bass=1.05, sparkle=.45, rain=0., perc=+.25, wet=.80, gate=.45),
    "tender":  dict(dens=2, bright=.00,  decay=1.15, pad=1.0, keys=.90,  bass=.90,  sparkle=.08, rain=0., perc=-.05, wet=1.0, gate=1.0),
    "rainy":   dict(dens=1, bright=-.35, decay=1.30, pad=1.1, keys=.85,  bass=.80,  sparkle=0.,  rain=1., perc=-.35, wet=1.2, gate=1.0),
    "sleepy":  dict(dens=0, bright=-.30, decay=1.60, pad=.95, keys=.80,  bass=.70,  sparkle=0.,  rain=0., perc=-.60, wet=1.3, gate=1.0),
}

# (beat in bar, ladder index, velocity). Ladder = chord tones from a low root upward (root, 5th, 8ve, 10th, ...).
PATTERNS = {
    3: {0: [(0, 0, 1.0), (1, 3, .55)],
        1: [(0, 0, 1.0), (1, 2, .70), (2, 3, .66)],
        2: [(0, 0, 1.0), (.5, 1, .60), (1, 2, .72), (1.5, 3, .60), (2, 2, .68), (2.5, 1, .56)],
        3: [(0, 0, 1.0), (.5, 2, .62), (1, 3, .74), (1.5, 4, .60), (2, 3, .70), (2.5, 5, .58)]},
    4: {0: [(0, 0, 1.0), (2, 3, .60)],
        1: [(0, 0, 1.0), (1, 2, .70), (2, 3, .72), (3, 2, .64)],
        2: [(0, 0, 1.0), (.5, 1, .58), (1, 2, .70), (1.5, 3, .60), (2, 4, .74), (2.5, 3, .58), (3, 2, .66), (3.5, 1, .55)],
        3: [(0, 0, 1.0), (.5, 2, .60), (1, 1, .70), (1.5, 3, .60), (2, 2, .74), (2.5, 4, .60), (3, 3, .68), (3.5, 5, .58)]},
}

PALETTES = {  # arpeggio instrument, its low-root range, bus, gain; bass gain multiplier
    "musicbox":   dict(inst="tine",   lo=55, bus="box",  gain=.55, bass=1.0),
    "felt-piano": dict(inst="piano",  lo=48, bus="keys", gain=1.0, bass=1.0),
    "guitar":     dict(inst="guitar", lo=40, bus="keys", gain=1.0, bass=.75),
}

_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_QUAL = [("maj7", [0, 4, 7, 11]), ("m7b5", [0, 3, 6, 10]), ("dim", [0, 3, 6]), ("aug", [0, 4, 8]),
         ("sus2", [0, 2, 7]), ("sus4", [0, 5, 7]), ("sus", [0, 5, 7]), ("m7", [0, 3, 7, 10]), ("min", [0, 3, 7]),
         ("m", [0, 3, 7]), ("7", [0, 4, 7, 10]), ("6", [0, 4, 7, 9]), ("add9", [0, 4, 7, 2]), ("", [0, 4, 7])]


def hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69) / 12)


def _bq_sos(kind, f, gain_db, q, sr):
    """RBJ biquad as one sos row: kind in peak|low|high (shelves use q as slope S)."""
    A = 10 ** (gain_db / 40)
    w = TAU * f / sr
    cw, sw = math.cos(w), math.sin(w)
    if kind == "peak":
        al = sw / (2 * q)
        b = [1 + al * A, -2 * cw, 1 - al * A]
        a = [1 + al / A, -2 * cw, 1 - al / A]
    else:
        al = sw / 2 * math.sqrt((A + 1 / A) * (1 / q - 1) + 2)
        s = 2 * math.sqrt(A) * al
        if kind == "high":
            b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
            a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
        else:
            b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s)]
            a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s]
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]]])


def _eq(x, sr, bands):
    sos = np.vstack([_bq_sos(k, f, g, q, sr) for k, f, g, q in bands])
    return sosfilt(sos, x, axis=-1)


def _filt(x, kind, f, sr, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=sr, output="sos"), x, axis=-1)


# ----------------------------------------------------------------------------------------------- comp parsing

def _parse_chord(name):
    name = (name or "").strip()
    if not name or name[0].upper() not in _PC:
        return None
    pc, rest = _PC[name[0].upper()], name[1:]
    while rest and rest[0] in "#b♯♭":
        pc += 1 if rest[0] in "#♯" else -1
        rest = rest[1:]
    rest = rest.split("/")[0]
    for q, iv in _QUAL:
        if rest.startswith(q):
            root = 48 + pc % 12
            return [root + i for i in iv]
    return None


def _normalize(comp: dict) -> dict:
    bpm = float(np.clip(float(comp.get("bpm") or 90), 40, 200))
    meter = int(comp.get("meter") or 4)
    meter = meter if 2 <= meter <= 7 else 4
    key = comp.get("key") or {}
    tonic = int(key.get("tonic", 60))
    mode = "minor" if str(key.get("mode", "major")).lower().startswith("min") else "major"
    st = comp.get("style") or {}
    energy = float(np.clip(float(st.get("energy", .4)), 0, 1))
    brightness = float(np.clip(float(st.get("brightness", .5)), 0, 1))
    pal = str(st.get("palette", "musicbox")).lower().replace("_", "-").replace(" ", "-")
    pal = {"piano": "felt-piano", "felt": "felt-piano", "feltpiano": "felt-piano", "nylon": "guitar",
           "music-box": "musicbox", "celesta": "musicbox"}.get(pal, pal)
    pal = pal if pal in PALETTES else "musicbox"

    tonic_triad = [48 + tonic % 12 + i for i in ([0, 3, 7] if mode == "minor" else [0, 4, 7])]
    bars = []
    for b in comp.get("bars") or []:
        tones = [int(round(t)) for t in (b.get("tones") or []) if t is not None]
        if not tones:
            tones = _parse_chord(b.get("chord")) or (bars[-1]["tones"] if bars else tonic_triad)
        bars.append({"chord": b.get("chord", ""), "tones": tones})
    total_beats = float(comp.get("total_beats") or 0)
    n_bars = max(len(bars), int(math.ceil(total_beats / meter - 1e-6)), 1)
    while len(bars) < n_bars:
        bars.append(dict(bars[-1]) if bars else {"chord": "", "tones": tonic_triad})
    total_beats = float(n_bars * meter)

    mel = []
    for n in comp.get("melody") or []:
        m = n.get("midi")
        if m is None or m <= 0:
            continue
        mel.append({"beat": float(n["beat"]), "dur": max(.1, float(n.get("dur", 1))), "midi": float(m)})
    mel.sort(key=lambda n: n["beat"])

    kinds = [None] * n_bars
    moods = [None] * n_bars
    secid = [0] * n_bars
    for i, s in enumerate(sorted(comp.get("sections") or [], key=lambda s: s.get("bar", 0))):
        a = int(s.get("bar", 0))
        for b in range(max(0, a), min(n_bars, a + int(s.get("bars", 1)))):
            kinds[b] = str(s.get("kind", "verse")).lower()
            md = str(s.get("mood", "tender")).lower()
            moods[b] = md if md in MOODS else "tender"
            secid[b] = i + 1
    if all(k is None for k in kinds) and mel:  # no sections: infer intro/outro around the melody
        first, last = int(mel[0]["beat"] // meter), int((mel[-1]["beat"] + mel[-1]["dur"]) // meter)
        for b in range(n_bars):
            kinds[b] = "intro" if b < first else "outro" if b > last else "verse"
            secid[b] = 0 if b < first else 2 if b > last else 1
    for b in range(n_bars):  # gaps inherit the previous bar
        if kinds[b] is None:
            kinds[b] = kinds[b - 1] if b else "verse"
            secid[b] = secid[b - 1] if b else 0
        if moods[b] is None:
            moods[b] = moods[b - 1] if b else "tender"
        if kinds[b] not in ("intro", "verse", "refrain", "outro"):
            kinds[b] = "verse"
    return dict(bpm=bpm, meter=meter, tonic=tonic, mode=mode, energy=energy, brightness=brightness, palette=pal,
                bars=bars, n_bars=n_bars, total_beats=total_beats, melody=mel, kinds=kinds, moods=moods, secid=secid)


def _chord_info(tones):
    root = tones[0]
    pcs = []
    for t in tones:
        if t % 12 not in pcs:
            pcs.append(t % 12)
    minor = (root + 3) % 12 in pcs and (root + 4) % 12 not in pcs
    return {"root": root, "pcs": pcs, "minor": minor}


def _in_range(p, lo):
    """Move pitch p by octaves into [lo, lo + 12)."""
    return int(lo + (p - lo) % 12)


# ----------------------------------------------------------------------------------------------- reverb

_IR_CACHE = {}


def _reverb_ir(sr, rt60, length, predelay, bright_rt, seed):
    key = (sr, rt60, length, predelay, bright_rt, seed)
    if key not in _IR_CACHE:
        rng = np.random.default_rng(seed)
        n = int(length * sr)
        t = np.arange(n) / sr
        ir = np.zeros((2, n))
        for ch in range(2):
            x = rng.normal(0, 1, n)
            hi, lo = _filt(x, "highpass", 2500, sr), _filt(x, "lowpass", 2500, sr)
            ir[ch] = lo * np.exp(-6.9 * t / rt60) + hi * np.exp(-6.9 * t / (rt60 * bright_rt))
            ir[ch] *= np.minimum(1, t / .03)  # diffuse onset
        ir[:, : int(predelay * sr)] = 0
        ir /= np.sqrt((ir ** 2).sum(1, keepdims=True))
        _IR_CACHE[key] = ir.astype(F32)
    return _IR_CACHE[key]


def _convolve(x, ir):
    """x (2, n), ir (2, m) -> (2, n) wet signal, truncated to n."""
    return np.stack([oaconvolve(x[ch], ir[ch])[: x.shape[1]] for ch in range(2)]).astype(F32)


# ----------------------------------------------------------------------------------------------- engine

class _Engine:
    def __init__(self, comp: dict, sr: int):
        self.c = c = _normalize(comp)
        self.sr = sr
        seed = zlib.crc32(json.dumps(comp, sort_keys=True, default=str).encode())
        self.rng = np.random.default_rng(seed)
        self.M = c["meter"]
        self.spb = 60.0 / c["bpm"]
        self.bar_s = self.spb * self.M
        self.total_s = c["total_beats"] * self.spb
        self.N = int((self.total_s + 2 * self.bar_s + 14.0) * sr)
        self.bus = {k: np.zeros((2, self.N), F32) for k in BUSES}
        self.srp = sr / 4
        self.pad_lo = np.zeros((2, self.N // 4 + 8), F32)
        self.cache = {}
        self.pal = PALETTES[c["palette"]]
        self.chords = [_chord_info(b["tones"]) for b in c["bars"]]
        mel = c["melody"]
        self.m_start = np.array([n["beat"] for n in mel]) if mel else np.zeros(0)
        self.m_end = np.array([n["beat"] + n["dur"] for n in mel]) if mel else np.zeros(0)
        self.m_midi = np.array([n["midi"] for n in mel]) if mel else np.zeros(0)
        if mel:  # music box sits in the octave above the voice: median around F5..E6
            med = float(np.median(self.m_midi))
            self.box_shift = int(12 * round((83 - med) / 12))
        else:
            self.box_shift = 12
        self.info = {"intro_notes": [], "outro_notes": [], "click_t": None, "sections": []}
        self._params()

    # ---- helpers
    def T(self, beat):
        return beat * self.spb

    def place(self, bus, t, sig, gain=1.0, pan=0.0):
        if gain <= 0:
            return
        i = int(round(t * self.sr))
        if i < 0:
            sig, i = sig[-i:], 0
        if i >= self.N or len(sig) == 0:
            return
        n = min(len(sig), self.N - i)
        a = (float(np.clip(pan, -1, 1)) + 1) * np.pi / 4
        s = sig[:n]
        b = self.bus[bus]
        b[0, i:i + n] += F32(math.cos(a) * 1.41421 * gain) * s
        b[1, i:i + n] += F32(math.sin(a) * 1.41421 * gain) * s

    def gate(self, sig, dur_s, release=.2):
        """Damp a note after dur_s seconds with a smooth release (piano pedal / guitar palm)."""
        n_on, n_rel = int(dur_s * self.sr), max(1, int(release * self.sr))
        if n_on + n_rel >= len(sig):
            return sig
        out = sig[: n_on + n_rel].copy()
        out[n_on:] *= np.linspace(1, 0, n_rel, dtype=F32) ** 2
        return out

    def sung_at(self, beat):
        if not len(self.m_start):
            return None
        i = int(np.searchsorted(self.m_start, beat + 1e-6, "right")) - 1
        if i >= 0 and beat < self.m_end[i] + .05:
            return self.m_midi[i]
        return None

    def _params(self):
        c, e = self.c, self.c["energy"]
        self.P = []
        run = 0
        for b in range(c["n_bars"]):
            kind, mood = c["kinds"][b], c["moods"][b]
            md = MOODS[mood]
            if b and (kind, mood, c["secid"][b]) != (c["kinds"][b - 1], c["moods"][b - 1], c["secid"][b - 1]):
                run += 1
            dens = md["dens"] + (1 if e > .75 else -1 if e < .3 else 0)
            if mood == "tender" and e < .5:
                dens = min(dens, 1)
            if mood == "playful":
                dens = 3 if e >= .3 else 2
            ref = kind == "refrain"
            px = e + md["perc"] + (.1 if ref else 0)
            self.P.append(dict(
                kind=kind, mood=mood, run=run, dens=int(np.clip(dens, 0, 3)),
                bright=float(np.clip(c["brightness"] + md["bright"] + (.05 if ref else 0), 0, 1)),
                decay=md["decay"], gate=md["gate"], wet=md["wet"], rain=md["rain"],
                pad=md["pad"] * (1.15 if ref else 1.0),
                keys=md["keys"] * (.8 + .4 * e) * (1.08 if ref else 1.0),
                bass=md["bass"] * (.85 + .3 * e),
                sparkle=md["sparkle"] * (.5 + e),
                perc=0.0 if px < .6 else min(1.0, .35 + (px - .6) * 2)))
        for b in range(c["n_bars"]):
            if not b or self.P[b]["run"] != self.P[b - 1]["run"]:
                self.info["sections"].append({"bar": b, "t": self.T(b * self.M), "kind": self.P[b]["kind"],
                                              "mood": self.P[b]["mood"]})

    # ---- instruments (templates are cached; random detune/phase per variant)
    def tine(self, m, b=.5, d=1.0, cents=0.0, glide=0.0, unique=False):
        if not unique:
            key = ("tine", int(round(m)), round(b * 4) / 4, round(d, 1), int(self.rng.integers(3)))
            if key in self.cache:
                return self.cache[key]
        sr = self.sr
        f = float(hz(m)) * 2 ** ((cents + self.rng.normal(0, 2.5)) / 1200)
        tau = 2.2 * d * (523.0 / f) ** .6
        dur = float(np.clip(tau * 4, .4, 5.5 * d))
        n = int(dur * sr)
        t = np.arange(n, dtype=F32) / F32(sr)
        if glide:
            ratio = 2 ** (glide / 1200 * np.clip(np.arange(n) / (0.6 * n), 0, 1) ** .8)
            ph = np.mod(TAU * f * np.cumsum(ratio) / sr, TAU).astype(F32)
        else:
            ph = F32(TAU * f) * t
        y = np.zeros(n, F32)
        for r, a, dk in ((1, 1, 1), (2, .16 + .14 * b, .45), (3, .05 + .07 * b, .3), (5.4, .05 + .1 * b, .12),
                         (8.93, .02 + .06 * b, .05)):
            if f * r < sr / 2.3:
                y += F32(a) * np.sin(F32(r) * ph + F32(self.rng.uniform(0, TAU))) * np.exp(-t / F32(tau * dk))
        y *= np.minimum(1, t / F32(.0015))
        k = int(.004 * sr)
        click = _filt(self.rng.normal(0, 1, k), "highpass", 3000, sr) * np.exp(-np.arange(k) / (sr / 735))
        y[:k] += F32(.05 + .09 * b) * click.astype(F32)
        y[-int(.05 * sr):] *= np.linspace(1, 0, int(.05 * sr), dtype=F32)
        if not unique:
            self.cache[key] = y
        return y

    def piano(self, m, b=.5, d=1.0, long=False):
        key = ("pno", int(m), round(b * 4) / 4, round(d, 1), long)
        if key in self.cache:
            return self.cache[key]
        sr = self.sr
        f = float(hz(m))
        tau = float(np.clip(d * 3.4 * (261.6 / f) ** .5, .6, 8))
        dur = min(tau * 2.2, 8.0 if long else self.bar_s + .6)
        n = int(dur * sr)
        t = np.arange(n, dtype=F32) / F32(sr)
        Bc = .0003 * f / 261.6
        k = 1.5 + 4 * b
        env = (.55 * np.exp(-t / F32(.2 * tau)) + .45 * np.exp(-t / F32(tau))).astype(F32)
        inc = np.exp(-t * F32(.45 / tau)).astype(F32)
        y = np.zeros(n, F32)
        for h in range(1, 15):
            fh = h * f * math.sqrt(1 + Bc * h * h)
            if fh > min(sr / 2.3, 4500 + 7000 * b):
                break
            a = h ** -1.15 * math.exp(-(h - 1) / k) * (.3 + .7 * abs(math.sin(math.pi * h / 7.3)))
            y += F32(a) * np.sin(F32(TAU * fh) * t + F32(self.rng.uniform(0, TAU))) * env
            env *= inc
        y *= 1 + F32(.1) * np.cos(F32(TAU * (.4 + .5 * self.rng.random())) * t)  # unison strings beating
        att = .007 - .004 * b
        y *= np.minimum(1, t / F32(att))
        k2 = int(.035 * sr)
        thump = _filt(self.rng.normal(0, 1, k2), "lowpass", 380, sr) * np.exp(-np.arange(k2) / (.008 * sr))
        y[:k2] += F32(.12) * thump.astype(F32)
        y[-int(.03 * sr):] *= np.linspace(1, 0, int(.03 * sr), dtype=F32)
        self.cache[key] = y
        return y

    def guitar(self, m, b=.5, d=1.0, long=False):
        key = ("gtr", int(m), round(b * 4) / 4, round(d, 1), long)
        if key in self.cache:
            return self.cache[key]
        sr = self.sr
        f = float(hz(m))
        tau = float(np.clip(d * 2.3 * (196 / f) ** .45, .45, 5))
        dur = min(tau * 3, 7.0 if long else self.bar_s + .5)
        n = int(dur * sr)
        t = np.arange(n, dtype=F32) / F32(sr)
        p = .16 + .04 * self.rng.random()
        k = 1.4 + 3.6 * b
        env = np.exp(-t / F32(tau)).astype(F32)
        inc = np.exp(-t * F32(.6 / tau)).astype(F32)
        y = np.zeros(n, F32)
        for h in range(1, 19):
            fh = h * f * (1 + .00008 * h * h)
            if fh > min(sr / 2.3, 5000 + 5000 * b):
                break
            a = abs(math.sin(math.pi * h * p)) / h * math.exp(-(h - 1) / k)
            y += F32(a) * np.sin(F32(TAU * fh) * t + F32(self.rng.uniform(0, TAU))) * env
            env *= inc
        y *= np.minimum(1, t / F32(.0012))
        k2 = int(.006 * sr)
        y[:k2] += F32(.05 + .05 * b) * (_filt(self.rng.normal(0, 1, k2), "bandpass", [900, 4500], sr)
                                        * np.exp(-np.arange(k2) / (.0015 * sr))).astype(F32)
        y = _eq(y, sr, [("peak", 105, 3.0, 1.6), ("peak", 230, 2.0, 1.8), ("peak", 3000, -2.0, .8)]).astype(F32)
        y[-int(.03 * sr):] *= np.linspace(1, 0, int(.03 * sr), dtype=F32)
        self.cache[key] = y
        return y

    def keynote(self, m, b, d, long=False):
        inst = self.pal["inst"]
        if inst == "piano":
            return self.piano(m, b, d, long)
        if inst == "guitar":
            return self.guitar(m, b, d, long)
        return self.tine(m, b, d)

    def bassnote(self, m, d=1.0):
        key = ("bass", int(m), round(d, 1))
        if key in self.cache:
            return self.cache[key]
        sr = self.sr
        f = float(hz(m))
        n = int(min(3.6, self.bar_s * 2 + .6) * sr)
        t = np.arange(n, dtype=F32) / F32(sr)
        ph = F32(TAU * f) * t
        y = np.sin(ph) + F32(.28) * np.sin(2 * ph) + F32(.07) * np.sin(3 * ph) + F32(.03) * np.sin(4 * ph)
        y *= np.minimum(1, t / F32(.014)) * np.exp(-t / F32(1.5 * d))
        y[-int(.05 * sr):] *= np.linspace(1, 0, int(.05 * sr), dtype=F32)
        self.cache[key] = y.astype(F32)
        return self.cache[key]

    def noise_hit(self, kind):
        key = (kind, int(self.rng.integers(4)))
        if key in self.cache:
            return self.cache[key]
        sr = self.sr
        if kind == "shaker":
            n = int(.07 * sr)
            x = _filt(self.rng.normal(0, 1, n), "bandpass", [4500, 11000], sr)
            tt = np.arange(n) / sr
            y = x * np.minimum(1, tt / .012) * np.exp(-tt / .018)
        else:  # brush swish
            n = int(.22 * sr)
            x = _filt(self.rng.normal(0, 1, n), "bandpass", [1500, 7500], sr)
            tt = np.arange(n) / sr
            y = x * np.minimum(1, tt / .05) ** 1.5 * np.exp(-tt / .07)
        y = (y / (np.abs(y).max() + 1e-9)).astype(F32)
        self.cache[key] = y
        return y

    def pad_note(self, m, t0, t1, b, gain, pan, attack=.7, release=1.6):
        """Bowed pad note rendered into the quarter-rate pad bus."""
        srp = self.srp
        n = int((t1 - t0 + release) * srp)
        if n <= 0:
            return
        t = np.arange(n, dtype=F32) / F32(srp)
        f0 = float(hz(m))
        y = np.zeros(n, F32)
        kk = 2.2 + 2.6 * b
        for cents in (-7, 0, 6):
            f = f0 * 2 ** (cents / 1200) * (1 + .0022 * np.sin(TAU * 4.6 * np.arange(n) / srp + self.rng.uniform(0, TAU)))
            ph = np.mod(TAU * np.cumsum(f) / srp + self.rng.uniform(0, TAU), TAU).astype(F32)
            for h in range(1, 10):
                if f0 * h > min(4200.0, srp / 2.3):
                    break
                y += np.sin(F32(h) * ph) * F32(math.exp(-h / kk) / h)
        dur = t1 - t0
        env = np.minimum(1, t / F32(attack)) * np.clip((dur + release - t) / F32(release), 0, 1)
        y *= env * F32(gain / 3)
        i = int(round(t0 * srp))
        if i >= self.pad_lo.shape[1]:
            return
        k = min(n, self.pad_lo.shape[1] - i)
        a = (pan + 1) * np.pi / 4
        self.pad_lo[0, i:i + k] += F32(math.cos(a) * 1.41421) * y[:k]
        self.pad_lo[1, i:i + k] += F32(math.sin(a) * 1.41421) * y[:k]

    # ---- foley
    def ratchet(self, length):
        sr = self.sr
        out = np.zeros(int((length + .1) * sr), F32)
        turns = 2 if length > .8 else 1
        per = 7 if length > .8 else 5
        span = length / turns
        times = [k * span + .04 + i * (span * .62 / per) for k in range(turns) for i in range(per)]
        for t0 in times:
            n = int(.025 * sr)
            c = _filt(self.rng.normal(0, 1, n), "bandpass", [1800, 5200], sr) * np.exp(-np.arange(n) / (sr / 490))
            c += .5 * np.sin(TAU * 900 * np.arange(n) / sr) * np.exp(-np.arange(n) / (sr / 300))
            i = int(t0 * sr)
            out[i:i + n] += (c * (.6 + .4 * self.rng.random())).astype(F32)[: len(out) - i]
        return out

    def catch_click(self):
        sr = self.sr
        n = int(.04 * sr)
        x = _filt(self.rng.normal(0, 1, n), "bandpass", [2200, 7000], sr) * np.exp(-np.arange(n) / (sr / 500))
        x += .3 * np.sin(TAU * 610 * np.arange(n) / sr) * np.exp(-np.arange(n) / (sr / 160))
        x[int(.012 * sr):] += .35 * x[: n - int(.012 * sr)]  # the catch settles: tk-tk
        return x.astype(F32)

    # ---- arrangement
    def ladder(self, ch, lo, color=None):
        root = _in_range(ch["root"], lo)
        pcs = list(ch["pcs"]) + ([color] if color is not None else [])
        tones = sorted({p for p in range(root + 7, root + 31) if p % 12 in pcs})
        lad = [root] + tones
        while len(lad) < 7:
            lad.append(lad[-3] + 12)
        return lad

    def color_tone(self, b):
        ch = self.chords[b]
        if self.P[b]["mood"] != "rainy":
            return None
        return (ch["root"] + (2 if ch["minor"] else 9)) % 12  # minor add9 / major add6: a relative-minor tint

    def arrange(self):
        c, M, P = self.c, self.M, self.P
        kinds = c["kinds"]
        nb = c["n_bars"]
        intro = [b for b in range(nb) if kinds[b] == "intro"]
        outro_bars = [b for b in range(nb) if kinds[b] == "outro"]
        o_bar = outro_bars[-1] if outro_bars else nb  # start of the last outro run
        while o_bar - 1 in outro_bars:
            o_bar -= 1
        self.o_bar = o_bar
        lead = []  # the opening intro run (bars 0..k)
        while intro and len(lead) < len(intro) and intro[len(lead)] == len(lead):
            lead.append(len(lead))
        body = [b for b in range(o_bar) if b not in lead]
        if lead:
            self.do_intro(lead)
        self.do_body(body)
        self.do_pad(body)
        self.do_rain(body)
        self.do_outro()

    # intro: wind the key, then the first sung phrase on the box, alone
    def do_intro(self, bars):
        M = self.M
        nb_i = len(bars)
        r_len = min(1.25, .85 * self.bar_s) if nb_i >= 2 else min(.5, .45 * self.bar_s)
        self.place("sfx", 0.0, self.ratchet(r_len), gain=.55, pan=-.1)
        p0 = 1 if nb_i >= 2 else 0
        end_beat = (bars[-1] + 1) * M
        played_bars = set()
        if len(self.m_start):
            F = float(self.m_start[0])
            src_bar = int(F // M)
            shift = (bars[0] + p0) * M - src_bar * M
            P_entry = F  # the voice comes in here
            for k in range(len(self.m_start)):
                nbt = self.m_start[k] + shift
                if nbt >= end_beat or nbt + .25 > P_entry:
                    break
                tt = self.T(nbt)
                if tt < r_len + .05:
                    continue
                m = self.m_midi[k] + self.box_shift
                v = .85 if (nbt % M) < 1e-6 else .72
                self.place("box", tt, self.tine(m, .55, 1.1), gain=v * 1.35, pan=.15)
                self.info["intro_notes"].append((tt, float(m), k))
                played_bars.add(int(nbt // M))
            for b in sorted(played_bars):
                sb = b - (bars[0] + p0) + src_bar
                ch = self.chords[min(max(sb, 0), len(self.chords) - 1)]
                self.place("box", self.T(b * M), self.tine(_in_range(ch["root"], 60), .45, 1.1), gain=.55, pan=-.25)
        for b in bars[p0:]:
            if b in played_bars:
                continue
            ch = self.chords[b]  # no melody here: a slow broken chord on the box
            lad = self.ladder(ch, 60)
            for j, (bt, idx, v) in enumerate(PATTERNS.get(M, PATTERNS[4])[1]):
                self.place("box", self.T(b * M + bt), self.tine(lad[min(idx, 6)], .5, 1.1), gain=.5 * v, pan=.2 * math.sin(j))
        # pad breathes in on the last intro bar
        if nb_i >= 2:
            b = bars[-1]
            for k, m in enumerate(self.voicing(b)):
                self.pad_note(m, self.T(b * M), self.T((b + 1) * M) + .3, self.P[b]["bright"], .45 * self.P[b]["pad"],
                              (k - 1.5) * .3, attack=self.bar_s * .8)

    def voicing(self, b):
        ch = self.chords[b]
        pcs = list(ch["pcs"])
        col = self.color_tone(b)
        if col is not None:
            pcs.append(col)
        return sorted({_in_range(p, 55) for p in pcs})

    def do_body(self, body):
        c, M, P = self.c, self.M, self.P
        pal = self.pal
        rng = self.rng
        bass_events = []
        prev_kind = "intro"
        for b in body:
            p = P[b]
            ch = self.chords[b]
            t0 = b * M
            bend = self.T((b + 1) * M)
            # arpeggio
            lad = self.ladder(ch, pal["lo"], self.color_tone(b))
            pat = PATTERNS.get(M)
            pat = pat[p["dens"]] if pat else [(k, [0, 2, 3, 2][k % 4], 1.0 if k == 0 else .7) for k in range(M)]
            for bt, idx, v in pat:
                if p["mood"] == "bright" and idx >= 2 and bt % 1:
                    idx += 1
                m = lad[min(idx, len(lad) - 1)]
                beat = t0 + bt
                sung = self.sung_at(beat)
                g = pal["gain"] * p["keys"] * v * (1 + rng.normal(0, .06))
                if sung is not None and abs(m - sung) <= 2:
                    g *= .45  # leave the sung pitch to the voice
                tt = self.T(beat) + (rng.normal(0, .004) if pal["inst"] != "tine" else 0)
                sig = self.keynote(m, p["bright"], p["decay"])
                if pal["inst"] == "piano":
                    sig = self.gate(sig, min(bend - tt, p["gate"] * self.spb * 2 if p["gate"] < 1 else 99), .25)
                elif pal["inst"] == "guitar":
                    sig = self.gate(sig, bend - tt + .05, .15)
                pan = (-.35 + .7 * (idx / 6)) if pal["inst"] != "guitar" else .2 - .3 * (idx == 0)
                self.place(pal["bus"], tt, sig, gain=g, pan=pan)
            # guitar: soft strum to open a bright/playful section
            if pal["inst"] == "guitar" and p["mood"] in ("bright", "playful") and (b == body[0] or P[b - 1]["run"] != p["run"]):
                for j, m in enumerate(lad[1:5]):
                    self.place("keys", self.T(t0) + .03 + j * .028, self.gate(self.guitar(m, p["bright"], p["decay"]), self.bar_s, .2),
                               gain=.35 * p["keys"], pan=.1 * j)
            # bass
            root = _in_range(ch["root"], 38)
            bass_events.append((t0, root, 1.0, p))
            if M == 4 and p["dens"] >= 2:
                bass_events.append((t0 + 2, root + 7 if root + 7 <= 52 else root - 5, .72, p))
            elif M == 3 and p["dens"] >= 3:
                bass_events.append((t0 + 2, root + 7 if root + 7 <= 52 else root - 5, .6, p))
            # refrain: the box doubles the melody softly; a lid-opening sparkle at its first bar
            if p["kind"] == "refrain":
                if prev_kind != "refrain":
                    tones = [x for x in self.ladder(ch, 72) if x >= 76][:5]
                    for j, m in enumerate(tones):
                        self.place("box", self.T(t0) - (len(tones) - j) * .05, self.tine(m, .6, 1.0), gain=.2, pan=-.5 + .25 * j)
                sel = np.where((self.m_start >= t0) & (self.m_start < t0 + M))[0]
                for k in sel:
                    m = self.m_midi[k] + self.box_shift
                    m = m - 12 if m > 96 else m
                    self.place("box", self.T(self.m_start[k]), self.tine(m, p["bright"], 1.0), gain=.17, pan=.3)
            prev_kind = p["kind"]
            # sparkle: a high chord tone on an offbeat
            if p["sparkle"] > 0 and rng.random() < p["sparkle"]:
                bt = M - .5 if rng.random() < .6 else 1.5
                tones = [x for x in self.ladder(ch, 72) if 84 <= x < 98]
                if tones:
                    self.place("box", self.T(t0 + bt), self.tine(tones[int(rng.integers(len(tones)))], .7, .9),
                               gain=.16, pan=float(rng.uniform(-.6, .6)))
            # brushes / shaker
            if p["perc"] > 0:
                for e8 in range(2 * M):
                    acc = 1.0 if e8 % 2 == 0 else .55
                    self.place("perc", self.T(t0 + e8 / 2) + rng.normal(0, .003), self.noise_hit("shaker"),
                               gain=.5 * p["perc"] * acc * (1 + rng.normal(0, .1)), pan=.35)
                backs = (1, 3) if M == 4 else (1, 2) if M == 3 else tuple(range(1, M))
                for bb in backs:
                    self.place("perc", self.T(t0 + bb), self.noise_hit("brush"), gain=.42 * p["perc"] * (1 if bb != 2 or M != 3 else .7),
                               pan=-.25)
        # bass notes ring until the next one
        for i, (bt, m, v, p) in enumerate(bass_events):
            nxt = bass_events[i + 1][0] if i + 1 < len(bass_events) else bt + M
            sig = self.gate(self.bassnote(m, p["decay"]), self.T(nxt - bt) - .03, .12)
            self.place("bass", self.T(bt), sig, gain=v * p["bass"] * self.pal["bass"])
        self.last_body_bar = body[-1] if body else -1

    def do_pad(self, body):
        """Sustained pad, tones held across bars while they stay in the chord (and in the same section)."""
        M, P = self.M, self.P
        active = {}  # midi -> [start_bar, end_bar, run]
        notes = []
        for b in body:
            vo = self.voicing(b)
            if P[b]["mood"] == "sleepy" and len(vo) > 3:
                vo = vo[:3]
            for m in list(active):
                s, e, run = active[m]
                if m not in vo or e != b or run != P[b]["run"]:
                    notes.append((m, s, e))
                    del active[m]
            for m in vo:
                if m in active:
                    active[m][1] = b + 1
                else:
                    active[m] = [b, b + 1, P[b]["run"]]
        notes += [(m, s, e) for m, (s, e, _) in active.items()]
        for m, s, e in sorted(notes, key=lambda x: (x[1], x[0])):
            p = P[s]
            pan = float(np.clip((m - 61) / 8, -.7, .7))
            att = .5 + .4 * (p["mood"] in ("sleepy", "rainy"))
            self.pad_note(m, self.T(s * M), self.T(e * M), p["bright"], p["pad"], pan, attack=att)

    def do_rain(self, body):
        """Rain on the window for rainy sections: hiss bed + droplets + a few high pentatonic drips on the box."""
        sr, M, P, rng = self.sr, self.M, self.P, self.rng
        rb = [b for b in body if P[b]["rain"] > 0]
        if not rb:
            return
        t0, t1 = max(0.0, self.T(rb[0] * M) - 1.0), self.T((rb[-1] + 1) * M) + 1.5
        i0 = int(t0 * sr)
        n = min(int((t1 - t0) * sr), self.N - i0)
        tt = np.arange(n) / sr
        bed = np.zeros((2, n), F32)
        for ch in range(2):
            x = _filt(rng.normal(0, 1, n).astype(F32), "bandpass", [400, 7000], sr)
            lfo = .75 + .25 * np.sin(TAU * .13 * tt + rng.uniform(0, TAU)) * np.sin(TAU * .047 * tt + rng.uniform(0, TAU))
            imp = np.zeros(n, F32)
            k = rng.poisson(9 * n / sr)
            imp[rng.integers(0, n, k)] = rng.exponential(1, k).astype(F32)
            kl = int(.012 * sr)
            kt = np.arange(kl) / sr
            drop = np.sin(TAU * rng.uniform(2500, 4500) * kt) * np.exp(-kt / .002)
            bed[ch] = (x * lfo * .5 + 1.5 * oaconvolve(imp, drop)[:n]).astype(F32)
        # fade in/out around the rainy span, and silence it in non-rainy bars inside
        g = np.ones(n, F32)
        for b in range(rb[0], rb[-1] + 1):
            if P[b]["rain"] <= 0:
                a, z = int((self.T(b * M) - t0) * sr), int((self.T((b + 1) * M) - t0) * sr)
                g[max(0, a):max(0, z)] = 0
        g = uniform_filter1d(g, int(.8 * sr))
        g *= np.minimum(1, tt / 1.0) * np.clip((t1 - t0 - tt) / 1.5, 0, 1)
        self.bus["rain"][:, i0:i0 + n] += bed * g
        scale = [0, 2, 4, 7, 9] if self.c["mode"] == "major" else [0, 3, 5, 7, 10]
        notes = [p for p in range(84, 99) if (p - self.c["tonic"]) % 12 in scale]
        for b in rb:
            for beat in range(M):
                if rng.random() < .35:
                    self.place("box", self.T(b * M + beat + rng.uniform(0, 1)), self.tine(notes[int(rng.integers(len(notes)))], .25, 1.2),
                               gain=float(rng.uniform(.05, .11)), pan=float(rng.uniform(-.8, .8)))

    # outro: the last phrase on the box, the spring running out
    def do_outro(self):
        c, M, P = self.c, self.M, self.P
        nb = c["n_bars"]
        ob0 = self.o_bar * M
        end_beat = c["total_beats"]
        lastb = min(self.o_bar, nb - 1)
        p_out = P[lastb]
        # the bar under a held final word: a soft cadence chord, pad and bass
        last_end = float(self.m_end.max()) if len(self.m_end) else 0.0
        if last_end > ob0 + .25 and self.o_bar < nb:
            ch = self.chords[self.o_bar]
            lad = self.ladder(ch, self.pal["lo"])
            for j, m in enumerate(lad[:5]):
                sig = self.keynote(m, P[self.o_bar]["bright"], 1.6, long=True)
                self.place(self.pal["bus"], self.T(ob0) + j * .035, sig, gain=.5 * self.pal["gain"] * (1 - .08 * j), pan=-.3 + .15 * j)
            self.place("bass", self.T(ob0), self.bassnote(_in_range(ch["root"], 38), 1.6), gain=.7 * p_out["bass"] * self.pal["bass"])
            for k, m in enumerate(self.voicing(self.o_bar)):
                self.pad_note(m, self.T(ob0), self.T(max(last_end, ob0 + M)) + .5, p_out["bright"], .8 * p_out["pad"], (k - 1.5) * .3)
        ob = max(float(ob0), math.ceil(last_end + .5)) if len(self.m_end) else float(ob0)
        avail = max(4.0, end_beat + M - ob)
        notes = [(float(self.m_start[k]), float(self.m_end[k] - self.m_start[k]), float(self.m_midi[k]))
                 for k in range(len(self.m_start))]
        if not notes:  # no melody: the tonic chord on the box, slowing
            ch = self.chords[-1]
            lad = self.ladder(ch, 72)
            notes = [(float(i), 1.0, float(m)) for i, m in enumerate(lad[:5])]
            shift = 0
        else:
            shift = self.box_shift
        i = len(notes) - 1
        while i > 0:
            pb, pd, _ = notes[i - 1]
            if notes[-1][0] - pb > 4 * M or (notes[i][0] - (pb + pd) >= .75 and notes[-1][0] - notes[i][0] >= 1.5 * M):
                break
            i -= 1
        phrase = notes[i:]
        rit = 1.2
        Ls = [phrase[-1][0] - n[0] + 1.0 for n in phrase]
        fits = [j for j in range(len(phrase)) if Ls[j] * (1 + rit / 3) <= avail]
        if fits:
            j0 = fits[0]
            good = [j for j in fits if Ls[j] >= .6 * Ls[j0] and (j == 0 or phrase[j - 1][1] >= 1.5 or
                                                                phrase[j][0] - phrase[j - 1][0] - phrase[j - 1][1] >= .5)]
            j = good[0] if good else j0
            rit = float(np.clip(3 * (avail / Ls[j] - 1), 1.2, 2.4))
        else:
            j = max(0, len(phrase) - 3)
            rit = max(.3, 3 * (avail / Ls[j] - 1))
        frag = phrase[j:]
        s0 = frag[0][0]
        L = Ls[j]
        cc = rit / L ** 2

        def warp(x):
            return x + cc * x ** 3 / 3

        t_start = self.T(ob)
        last_t = t_start
        for k, (bt, du, m) in enumerate(frag):
            x = bt - s0
            tt = t_start + self.T(warp(x))
            cents = -55.0 * (x / L) ** 1.5
            final = k == len(frag) - 1
            mm = m + shift
            mm = mm - 12 if mm > 96 else mm
            sig = self.tine(mm, .5, 1.25, cents=cents, glide=-30.0 if final else 0.0, unique=True)
            self.place("box", tt, sig, gain=(.9 - .25 * k / max(1, len(frag) - 1)) * 1.35, pan=.15)
            self.info["outro_notes"].append((tt, float(mm), cents, x))
            last_t = tt
        # pad follows the phrase's chords on the warped clock, then holds the last one
        sb0, sb1 = int(s0 // M), int((s0 + L - 1e-6) // M)
        changes = [(0.0, sb0)] + [(k * M - s0, k) for k in range(sb0 + 1, sb1 + 1)]
        end_pad = last_t + 1.0
        for q, (x, bi) in enumerate(changes):
            bi = min(max(bi, 0), nb - 1)
            ta = t_start + self.T(warp(x))
            tb = t_start + self.T(warp(changes[q + 1][0])) + .2 if q + 1 < len(changes) else end_pad
            for k2, m in enumerate(self.voicing(bi)):
                self.pad_note(m, ta, tb, .3, .7 * p_out["pad"], (k2 - 1.5) * .3, attack=.9, release=2.5 if q + 1 == len(changes) else 1.2)
            self.place("box", ta, self.tine(_in_range(self.chords[bi]["root"], 60), .4, 1.25), gain=.3, pan=-.25)
        click_t = last_t + max(.9, self.spb * (1 + rit) * 1.1)
        self.place("sfx", click_t, self.catch_click(), gain=.6, pan=.1)
        self.info["click_t"] = click_t
        self.end_t = max(click_t + 5.0, self.T(ob0) + 2.0)

    # ---- mixdown
    @staticmethod
    def _tilt(p):
        return float(np.clip(.22 + .9 * p["bright"], .2, 1.0))

    def _curve(self, per_bar, tail):
        """Per-bar values -> per-sample curve with half-beat ramps at bar lines."""
        knots_t, vals = [], []
        for b, v in enumerate(per_bar):
            a, z = self.T(b * self.M), self.T((b + 1) * self.M)
            knots_t += [a + .25 * self.spb, z - .25 * self.spb]
            vals += [v, v]
        knots_t.append(max(self.N / self.sr, knots_t[-1] + .1))
        vals.append(tail)
        idx = np.arange(0, self.N + 64, 64)
        return np.interp(np.arange(self.N), idx, np.interp(idx / self.sr, knots_t, vals)).astype(F32)

    def render(self):
        sr, M = self.sr, self.M
        self.arrange()
        pad = resample_poly(self.pad_lo, 4, 1, axis=1).astype(F32)
        k = min(pad.shape[1], self.N)
        self.bus["pad"][:, :k] += pad[:, :k]
        # section automation: reverb send (wetter when sleepy/rainy) and tone tilt (dark..open) per bar
        wet_c = self._curve([p["wet"] * (1.35 if p["kind"] == "outro" else 1.0) for p in self.P], 1.4)
        tilt_c = self._curve([max(.85, self._tilt(p)) if p["kind"] in ("intro", "outro") else self._tilt(p) for p in self.P], .85)
        dry = np.zeros((2, self.N), F32)
        send = np.zeros((2, self.N), F32)
        self.info["bus_rms_db"] = {}
        body_a = int(self.T(self.c["kinds"].index("verse") * M) * sr) if "verse" in self.c["kinds"] else 0
        body_z = int(self.total_s * sr)
        for name in BUSES:
            x = self.bus[name]
            if name == "bass":
                x = _filt(x, "lowpass", 900, sr).astype(F32)
            if name == "pad":
                x = _filt(x, "highpass", 140, sr).astype(F32)
            if name in ("box", "keys", "pad"):
                dark = _filt(x, "lowpass", 1800, sr).astype(F32)
                x = dark + tilt_c * (x - dark)
            dry += x * F32(LEVELS[name])
            send += x * F32(LEVELS[name] * SENDS[name])
            seg = x[:, body_a:body_z] * LEVELS[name]
            self.info["bus_rms_db"][name] = round(float(10 * np.log10(np.mean(seg ** 2) + 1e-12)), 1)
        ir = _reverb_ir(sr, 2.4, 3.2, .022, .45, 11)
        out = dry + _convolve(send * wet_c, ir) * F32(.9)
        n = min(self.N, int(self.end_t * sr))
        out = out[:, :n]
        out = _filt(out, "highpass", 30, sr)
        fade = int(1.2 * sr)
        out[:, -fade:] *= np.linspace(1, 0, fade) ** 2
        return out.astype(F32)


# ----------------------------------------------------------------------------------------------- mastering

def _loudness(x, sr):
    """Integrated LUFS of (2, n) or (n,) audio."""
    import pyloudnorm as pyln
    a = x.T if x.ndim == 2 else x
    if a.shape[0] < sr // 2:
        return -70.0
    v = pyln.Meter(sr).integrated_loudness(np.asarray(a, dtype=np.float64))
    return float(v) if np.isfinite(v) else -70.0


def true_peak_db(x, sr=44100):
    """4x-oversampled peak in dBTP of (2, n) audio."""
    up = resample_poly(np.asarray(x, dtype=np.float64), 4, 1, axis=-1)
    return float(20 * np.log10(np.abs(up).max() + 1e-12))


def _peak_env(x, floor):
    """Per-sample peak across channels, refined to the 4x-oversampled (true) peak wherever it is above floor."""
    n = x.shape[1]
    pk = np.abs(x).max(0)
    B = 2048
    nb = -(-n // B)
    hot = np.pad(pk, (0, nb * B - n)).reshape(nb, B).max(1) > floor
    i = 0
    while i < nb:
        if not hot[i]:
            i += 1
            continue
        j = i
        while j + 1 < nb and hot[j + 1]:
            j += 1
        s, e = max(0, i * B - 64), min(n, (j + 1) * B + 64)
        up = resample_poly(x[:, s:e], 4, 1, axis=1)
        pk[s:e] = np.maximum(pk[s:e], np.abs(up).max(0)[: 4 * (e - s)].reshape(e - s, 4).max(1))
        i = j + 1
    return pk


def _limit(x, sr, ceil_db):
    """Look-ahead true-peak limiter (vectorized): gain never exceeds what the 4x-oversampled peak needs."""
    ceil = 10 ** (ceil_db / 20) * .985
    for _ in range(3):
        pk = _peak_env(x, ceil * .7)
        if pk.max() <= ceil / .985:
            break
        g = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
        r = int(.012 * sr)
        g = minimum_filter1d(g, 2 * r + 1)
        g = uniform_filter1d(g, r)
        x = x * g
    return x


def _master(x, sr, lufs, tp_db):
    x = np.asarray(x, dtype=np.float64)
    L = _loudness(x, sr)
    for _ in range(3):
        x = x * 10 ** ((lufs - L) / 20)
        x = _limit(x, sr, tp_db)
        L = _loudness(x, sr)
        if abs(L - lufs) < .3:
            break
    return x


def _render(comp: dict, sr: int = 44100):
    eng = _Engine(comp, sr)
    out = eng.render().astype(np.float64)
    out = _master(out, sr, INSTRUMENTAL_LUFS, -1.0)
    eng.info["box_shift"] = eng.box_shift
    return out.T.astype(F32), eng.info


def render_instrumental(comp: dict, sr: int = 44100) -> np.ndarray:
    """The accompaniment alone as float32 stereo (n, 2), about -18 LUFS. Beat 0 of comp = sample 0."""
    return _render(comp, sr)[0]


# ----------------------------------------------------------------------------------------------- vocal + mix

def _process_vocal(v, sr):
    """Mono vocal -> (2, n): HPF, EQ, light compression, side-only width, a little plate."""
    v = np.asarray(v, dtype=np.float64)
    v = v - v.mean()
    v = _filt(v, "highpass", 90, sr)
    v = _eq(v, sr, [("peak", 250, -2.0, 1.0), ("peak", 3200, 2.5, .9), ("high", 9500, 1.5, .8)])
    win = int(.012 * sr)
    lev = 10 * np.log10(uniform_filter1d(v * v, win) + 1e-12)
    act = lev > lev.max() - 40
    if act.any():
        thr = np.percentile(lev[act], 70)
        gr = -np.maximum(lev - thr, 0) * (1 - 1 / 2.5)
        r = int(.006 * sr)
        gr = uniform_filter1d(minimum_filter1d(gr, 2 * r + 1), r)
        gr = uniform_filter1d(gr, int(.03 * sr))  # smooth release
        v = v * 10 ** (gr / 20)
    d = int(.011 * sr)
    side = np.zeros_like(v)
    side[d:] = _filt(v, "bandpass", [500, 5000], sr)[:-d]
    st = np.stack([v + .1 * side, v - .1 * side])
    ir = _reverb_ir(sr, 1.6, 2.2, .025, .7, 23)
    wet = _convolve(st.astype(F32), ir).astype(np.float64)
    wet = _filt(wet, "highpass", 250, sr)
    return st + .2 * wet


def _active_span(v, sr):
    r = np.sqrt(uniform_filter1d(v * v, int(.05 * sr)))
    a = np.where(r > r.max() * 10 ** (-40 / 20))[0]
    return (int(a[0]), int(a[-1])) if len(a) else (0, len(v))


def _write_mp3(x, sr, path):
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH")
    data = np.ascontiguousarray(np.clip(x.T, -1, 1).astype("<f4")).tobytes()
    cmd = [exe, "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "2", "-i", "pipe:0",
           "-c:a", "libmp3lame", "-b:a", "192k", str(path)]
    p = subprocess.run(cmd, input=data, capture_output=True)
    if p.returncode:
        raise RuntimeError("ffmpeg failed: " + p.stderr.decode(errors="replace")[-500:])


last_mix_info: dict = {}  # diagnostics of the latest mix() call


def mix(comp: dict, vocal: np.ndarray, vocal_sr: int, out_mp3: str, out_wav: str | None = None) -> float:
    """Render the instrumental, lay the vocal (sample 0 = beat 0) on top, master to -16 LUFS / -1.5 dBTP, export.

    Returns the duration in seconds.
    """
    sr = 44100
    inst = _Engine(comp, sr).render().astype(np.float64)  # raw (unmastered) accompaniment, (2, n)
    v = np.asarray(vocal, dtype=np.float64)
    if v.ndim == 2:
        v = v.mean(axis=1) if v.shape[1] <= 2 else v.mean(axis=0)
    v = np.nan_to_num(v)
    if vocal_sr != sr:
        g = gcd(int(vocal_sr), sr)
        v = resample_poly(v, sr // g, int(vocal_sr) // g)
    vox = _process_vocal(v, sr)
    n = max(inst.shape[1], vox.shape[1]) + int(1.2 * sr)
    bed = np.zeros((2, n))
    bed[:, : inst.shape[1]] = inst
    voc = np.zeros((2, n))
    voc[:, : vox.shape[1]] = vox
    # carve a pocket for the voice in the accompaniment (static, no ducking)
    bed = _eq(bed, sr, [("peak", 2800, -3.0, .8), ("peak", 1100, -1.2, 1.2), ("peak", 320, -1.0, 1.0)])
    a, z = _active_span(voc[0], sr)
    Lv = _loudness(voc[:, a:z], sr)
    Lb = _loudness(bed[:, a:z], sr)
    g = 10 ** ((Lv - VOCAL_OVER_BED_LU - Lb) / 20) if Lv > -69 and Lb > -69 else 1.0
    bed *= g
    last_mix_info.clear()
    last_mix_info.update(vocal_span_s=(a / sr, z / sr), vocal_lufs=Lv, bed_lufs_in_span=Lb + 20 * np.log10(g))
    out = bed + voc
    out = _filt(out, "highpass", 28, sr)
    fade = int(.6 * sr)
    out[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    out = _master(out, sr, MASTER_LUFS, TRUE_PEAK_DB)
    out = np.nan_to_num(out)
    _write_mp3(out, sr, out_mp3)
    if out_wav:
        import soundfile as sf
        sf.write(out_wav, out.T.astype(F32), sr, subtype="PCM_16")
    return n / sr
