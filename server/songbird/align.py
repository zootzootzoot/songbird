"""Put the lyric sheet on the record: where each line and word was actually sung.

ACE-Step's own lyric timestamps proved unreliable (whole verses stamped at 0:00, choruses at the same second), and
the singer sometimes changes or drops a line. So we listen instead: Demucs's isolated vocal is cut into sung phrases by
energy, Muse Voice Transcribe hears each phrase, and the sheet's words are aligned to the heard words in order.
Matched words get their heard time; the rest are interpolated between matches.
"""
from __future__ import annotations

import io
import re
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher

import numpy as np
import soundfile as sf

from . import meta

SR = 16000


def phrases(v: np.ndarray, sr: int = SR, hop: float = 0.02, gap: float = 0.38, shortest: float = 0.35,
            longest: float = 7.0) -> list[tuple[float, float]]:
    """Sung phrases as (start, end) seconds, from the vocal's energy."""
    n = int(sr * hop)
    rms = np.sqrt(np.convolve(v ** 2, np.ones(n) / n, mode="same")[::n] + 1e-12)
    on = rms > max(0.012, 0.14 * np.percentile(rms, 95))
    segs, start = [], None
    for i, x in enumerate(on):
        if x and start is None:
            start = i
        if not x and start is not None:
            segs.append([start, i])
            start = None
    if start is not None:
        segs.append([start, len(on)])
    merged: list[list[int]] = []
    for s in segs:
        if merged and (s[0] - merged[-1][1]) * hop < gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    out: list[tuple[float, float]] = []
    for a, b in merged:
        if (b - a) * hop < shortest:
            continue
        # split long phrases at their quietest point so each transcription stays short
        stack = [(a, b)]
        while stack:
            a2, b2 = stack.pop()
            if (b2 - a2) * hop <= longest:
                out.append((a2 * hop, b2 * hop))
                continue
            lo, hi = a2 + int(1.5 / hop), b2 - int(1.5 / hop)
            cut = lo + int(np.argmin(rms[lo:hi]))
            stack += [(cut, b2), (a2, cut)]
    return sorted(out)


def _hear(v: np.ndarray, a: float, b: float) -> str:
    buf = io.BytesIO()
    sf.write(buf, v[int(a * SR):int(b * SR)], SR, format="WAV", subtype="PCM_16")
    try:
        return meta.transcribe_wav(buf.getvalue())
    except Exception:
        return ""


def _words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", s.lower())


def _sim(a: str, b: str) -> float:
    return 1.0 if a == b else SequenceMatcher(None, a, b).ratio()


def _dp(sheet: list[str], heard: list[str], skip_sheet: float = -0.25, skip_heard: float = -0.15) -> list[tuple[int, int]]:
    """Monotonic word alignment (Needleman-Wunsch); a pair counts only if the words sound alike (ratio >= 0.6)."""
    n, m = len(sheet), len(heard)
    score = np.zeros((n + 1, m + 1))
    move = np.zeros((n + 1, m + 1), dtype=np.int8)  # 0 diag, 1 skip sheet word, 2 skip heard word
    score[1:, 0] = skip_sheet * np.arange(1, n + 1)
    score[0, 1:] = skip_heard * np.arange(1, m + 1)
    move[1:, 0], move[0, 1:] = 1, 2
    sim = np.array([[_sim(a, b) for b in heard] for a in sheet])
    gain = np.where(sim >= 0.6, sim, -1.0)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            opts = (score[i - 1, j - 1] + gain[i - 1, j - 1], score[i - 1, j] + skip_sheet, score[i, j - 1] + skip_heard)
            k = int(np.argmax(opts))
            score[i, j], move[i, j] = opts[k], k
    pairs, i, j = [], n, m
    while i > 0 and j > 0:
        if move[i, j] == 0:
            if gain[i - 1, j - 1] > 0:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif move[i, j] == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def align(vocal_wav: str, sheet: list[dict], length: float) -> list[dict] | None:
    """sheet: [{"text", ...}] in sung order -> the same dicts with start/end and words[{text,start,end}].
    None if too little was heard to trust."""
    v, sr = sf.read(vocal_wav, dtype="float32")
    if v.ndim > 1:
        v = v.mean(1)
    if sr != SR:
        raise ValueError("vocal must be 16 kHz")
    segs = phrases(v)
    if not segs:
        return None
    with ThreadPoolExecutor(8) as ex:
        heard = list(ex.map(lambda s: _hear(v, *s), segs))

    # what was heard, word by word, each with a time spread evenly across its phrase
    hw, ht = [], []
    for (a, b), text in zip(segs, heard):
        ws = _words(text)
        for k, w in enumerate(ws):
            hw.append(w)
            ht.append(a + (b - a) * k / max(1, len(ws)))
    sw, owner = [], []
    for i, ln in enumerate(sheet):
        for w in _words(ln["text"]):
            sw.append(w)
            owner.append(i)
    if not hw or not sw:
        return None
    pairs = _dp(sw, hw)
    wtime: list[float | None] = [None] * len(sw)
    for a, b in pairs:
        wtime[a] = ht[b]
    known = [k for k, t in enumerate(wtime) if t is not None]
    if len(known) < 0.15 * len(sw):
        return None
    times = np.interp(np.arange(len(sw)), known, [wtime[k] for k in known])
    # nothing heard before the first anchor or after the last: keep a singing pace instead of a pile-up
    for k in range(known[0]):
        times[k] = max(0.0, times[known[0]] - 0.4 * (known[0] - k))
    for k in range(known[-1] + 1, len(sw)):
        times[k] = min(length - 0.2, times[known[-1]] + 0.4 * (k - known[-1]))

    out = []
    for i, ln in enumerate(sheet):
        idx = [k for k, o in enumerate(owner) if o == i]
        if not idx:
            out.append({**ln, "start": 0.0, "end": 0.0, "words": [], "sung": False})
            continue
        ts = [float(times[k]) for k in idx]
        shown = ln["text"].split()
        if len(shown) != len(ts):  # punctuation split a token differently; fall back to the plain words
            shown = _words(ln["text"])
        nxt = [*ts[1:], ts[-1] + 0.45]
        words = [{"text": t, "start": round(ts[j], 2), "end": round(max(ts[j] + 0.12, nxt[j] - 0.02), 2)}
                 for j, t in enumerate(shown)]
        # a line the singer skipped keeps its place but is marked, so nothing shows words nobody sang
        sung = sum(wtime[k] is not None for k in idx) / len(idx) >= 0.34
        out.append({**ln, "start": round(ts[0], 2), "end": words[-1]["end"], "words": words, "sung": sung})
    return out
