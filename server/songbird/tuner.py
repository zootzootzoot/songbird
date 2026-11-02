"""The tuner: does the singer agree with the band?

Splits a take with Meta's Hybrid Demucs (torchaudio's HDEMUCS_HIGH_MUSDB_PLUS), finds the band's key from the bass
and instruments, tracks the vocal's pitch, and reports how much of the sung time sits on the band's scale.
Calibrated on our own takes: score-driven vocals measure 0.93-0.96, a reference mix 0.83, and the ACE-Step takes a
listener called "out of key" 0.63-0.74. Needs only numpy, torch and torchaudio, so it runs inside the band's venv.
"""
from __future__ import annotations

import numpy as np
import torch
import torchaudio
from torchaudio.pipelines import HDEMUCS_HIGH_MUSDB_PLUS as BUNDLE

NOTES = "C C# D D# E F F# G G# A A# B".split()
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])  # Krumhansl-Kessler
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_model = None


def stems(path: str, device: str = "cpu") -> tuple[dict, int]:
    global _model
    if _model is None:
        _model = BUNDLE.get_model().eval()
    _model.to(device)
    y, sr = torchaudio.load(path)
    y = torchaudio.functional.resample(y, sr, BUNDLE.sample_rate)
    if y.shape[0] == 1:
        y = y.repeat(2, 1)
    ref = y.mean(0)
    y = (y - ref.mean()) / ref.std()
    out = []
    step = BUNDLE.sample_rate * 10  # 10 s chunks keep memory small
    with torch.no_grad():
        for a in range(0, y.shape[1], step):
            out.append(_model(y[None, :, a:a + step].to(device))[0].cpu())
    s = torch.cat(out, -1) * ref.std() + ref.mean()
    return {n: s[i].mean(0).numpy() for i, n in enumerate(_model.sources)}, BUNDLE.sample_rate


def _pitch_classes(x, sr, fmin=60, fmax=2000, n=8192, hop=4096):
    """Energy per pitch class from interpolated spectral peaks."""
    win, pc = np.hanning(n), np.zeros(12)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    band = (freqs > fmin) & (freqs < fmax)
    for a in range(0, len(x) - n, hop):
        S = np.abs(np.fft.rfft(x[a:a + n] * win))
        m = S[1:-1]
        for k in np.where((m > S[:-2]) & (m > S[2:]) & band[1:-1] & (m > m.max() * 0.1))[0] + 1:
            al, be, ga = np.log(S[k - 1] + 1e-9), np.log(S[k] + 1e-9), np.log(S[k + 1] + 1e-9)
            f = freqs[k] + 0.5 * (al - ga) / (al - 2 * be + ga) * (freqs[1] - freqs[0])
            pc[int(round(69 + 12 * np.log2(f / 440))) % 12] += S[k] ** 2
    return pc


def _vocal_midi(x, sr, n=2048, hop=512):
    """Autocorrelation f0 for voiced frames, in MIDI."""
    out, lo, hi = [], int(sr / 1000), int(sr / 80)
    for a in range(0, len(x) - n, hop):
        w = x[a:a + n] * np.hanning(n)
        if np.sqrt((w ** 2).mean()) < 0.01:
            continue
        ac = np.correlate(w, w, "full")[n - 1:]
        lag = lo + np.argmax(ac[lo:hi])
        if ac[lag] > 0.5 * ac[0]:
            out.append(69 + 12 * np.log2(sr / lag / 440))
    return np.array(out)


def _key(pc):
    best = (-2.0, 0, "major")
    for r in range(12):
        for mode, prof in (("major", MAJOR), ("minor", MINOR)):
            c = np.corrcoef(np.roll(prof, r), pc)[0, 1]
            if c > best[0]:
                best = (c, r, mode)
    return best[1], best[2]


def _scale(r, mode):
    steps = [0, 2, 4, 5, 7, 9, 11] if mode == "major" else [0, 2, 3, 5, 7, 8, 10]
    return [(r + s) % 12 for s in steps]


def measure(path: str, device: str = "cpu") -> dict:
    d, sr = stems(path, device)
    r, mode = _key(_pitch_classes(d["bass"] + d["other"], sr))
    midi = _vocal_midi(d["vocals"], sr)
    if len(midi) < 200:  # barely any singing found
        return {"bandKey": f"{NOTES[r]} {mode}", "vocalKey": None, "inKey": None}
    pcs = np.round(midi).astype(int) % 12
    vr, vmode = _key(np.bincount(pcs, minlength=12).astype(float))
    return {"bandKey": f"{NOTES[r]} {mode}", "vocalKey": f"{NOTES[vr]} {vmode}",
            "inKey": round(float(np.isin(pcs, _scale(r, mode)).mean()), 2)}
