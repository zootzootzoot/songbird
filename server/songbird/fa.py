"""Word timing by forced alignment: Meta's MMS aligner (torchaudio MMS_FA, open weights) on Demucs's isolated vocal.

Voice Transcribe tells us *which* lines were sung (align.py); this tells us *when*, word by word, to the 20 ms frame.
Runs in the band's environment (torch + torchaudio + the GPU). The vocal is split into overlapping windows so
wav2vec2's attention stays small, and a star token between lines soaks up ad-libs, breaths and echoes.
"""
from __future__ import annotations

import re

import torch
import torchaudio
from torchaudio.pipelines import MMS_FA as BUNDLE

SR = BUNDLE.sample_rate  # 16 kHz
_model = None
_dict = None


def _load(device: str):
    global _model, _dict
    if _model is None:
        _model = BUNDLE.get_model(with_star=True).eval()
        _dict = BUNDLE.get_dict(star="*")
    return _model.to(device), _dict


def _norm(word: str) -> str:
    return re.sub(r"[^a-z']", "", word.lower().replace("’", "'"))


@torch.inference_mode()
def emissions(wave: torch.Tensor, device: str, win: float = 24.0, pad: float = 2.0) -> tuple[torch.Tensor, float]:
    """Frame log-probs for the whole vocal, computed window by window; returns (T x C, seconds per frame)."""
    model, _ = _load(device)
    n, step, p = wave.shape[-1], int(win * SR), int(pad * SR)
    parts = []
    for a in range(0, n, step):
        lo, hi = max(0, a - p), min(n, a + step + p)
        em, _ = model(wave[:, lo:hi].to(device))
        em = em[0].float().cpu()
        fps = em.shape[0] / ((hi - lo) / SR)
        cut_lo = int(round((a - lo) / SR * fps))
        cut_hi = cut_lo + int(round((min(n, a + step) - a) / SR * fps))
        parts.append(em[cut_lo:cut_hi])
    em = torch.cat(parts)
    return em, (n / SR) / em.shape[0]


def _vocal(vocal_wav: str) -> torch.Tensor:
    wave, sr = torchaudio.load(vocal_wav)
    wave = wave.mean(0, keepdim=True)
    return torchaudio.functional.resample(wave, sr, SR) if sr != SR else wave


def _fit(em: torch.Tensor, spf: float, lines: list[list[str]], offset: float = 0.0) -> list[list]:
    """Force-align these lines (in order) onto these frames; per line, per word (start, end, score) or None."""
    _, d = _load("cpu")
    star = d["*"]
    tokens, owner = [star], []  # owner: (line, word, first token, last token + 1)
    for i, ws in enumerate(lines):
        for j, w in enumerate(ws):
            t = [d[c] for c in _norm(w) if c in d]
            if t:
                owner.append((i, j, len(tokens), len(tokens) + len(t)))
                tokens += t
        tokens.append(star)
    out: list[list] = [[None] * len(ws) for ws in lines]
    if len(tokens) * 1.1 > em.shape[0]:  # not enough frames to sing these words in
        return out
    ali, scores = torchaudio.functional.forced_align(em.unsqueeze(0), torch.tensor([tokens], dtype=torch.int32), blank=0)
    spans = torchaudio.functional.merge_tokens(ali[0], scores[0].exp())
    if len(spans) != len(tokens):
        return out
    for i, j, a, b in owner:
        seg = spans[a:b]
        s = sum(x.score * (x.end - x.start) for x in seg) / max(1, sum(x.end - x.start for x in seg))
        out[i][j] = (round(offset + seg[0].start * spf, 3), round(offset + seg[-1].end * spf, 3), round(float(s), 3))
    return out


def words(vocal_wav: str, lines: list[list[str]], device: str = "cuda") -> list[list[tuple[float, float, float]] | None]:
    """lines: the sung lines in order, each a list of display words. Returns per line, per word (start, end, score)
    in seconds; a word with no letters (a number, a dash) gets None and is filled by the caller."""
    em, spf = emissions(_vocal(vocal_wav), device)
    return _fit(em, spf, lines)


def release(device: str = "cuda"):
    """Give the GPU back to the band between jobs (the aligner waits in RAM)."""
    if _model is not None and device == "cuda":
        _model.to("cpu")
        torch.cuda.empty_cache()


def _place(ln: dict, ws: list[str], fa_ws: list, trust: float) -> list[dict] | None:
    """This line's words from the aligner, or None if the aligner wasn't sure."""
    found = [w for w in fa_ws if w]
    if not found or len(found) < 0.6 * len(ws) or sum(w[2] for w in found) / len(found) < trust:
        return None
    starts = [w[0] if w else None for w in fa_ws]
    known = [i for i, x in enumerate(starts) if x is not None]
    for i in range(len(starts)):  # a word with no letters sits beside its neighbours
        if starts[i] is None:
            lo = max([k for k in known if k < i], default=None)
            hi = min([k for k in known if k > i], default=None)
            starts[i] = starts[lo] + 0.15 if lo is not None else starts[hi] - 0.15
    ends = [w[1] if w else None for w in fa_ws]
    out = []
    for i, t in enumerate(ws):
        end = ends[i] if ends[i] is not None else starts[i] + 0.3
        if i + 1 < len(ws):
            end = min(end, starts[i + 1] - 0.02)
        out.append({"text": t, "start": round(starts[i], 2), "end": round(max(starts[i] + 0.12, end), 2)})
    return out


def retime(lines: list[dict], vocal_wav: str, device: str = "cuda", trust: float = 0.2, drift: float = 6.0) -> list[dict]:
    """lines: the record's lines (text, start, end, words[{text,start,end}]) with times from the Voice Transcribe pass.

    Pass 1 aligns the whole record at once; a line keeps the aligner's word times where it is confident (mean word
    score >= trust), lands near the heard time (within `drift` s) and stays in order. Pass 2 retries each line that
    didn't, alone, inside the gap between its aligned neighbours. Anything still unsure keeps its heard times.
    Each line gets "timing": "aligned" or "heard"."""
    shown = [[w["text"] for w in ln.get("words") or []] or ln["text"].split() for ln in lines]
    try:
        em, spf = emissions(_vocal(vocal_wav), device)
    finally:
        release(device)
    placed: list[list[dict] | None] = [None] * len(lines)
    prev_end = 0.0
    for i, (ln, ws, fa_ws) in enumerate(zip(lines, shown, _fit(em, spf, shown))):
        got = _place(ln, ws, fa_ws, trust)
        if got and abs(got[0]["start"] - (ln.get("start") or got[0]["start"])) <= drift and got[0]["start"] >= prev_end - 0.3:
            placed[i] = got
            prev_end = got[-1]["end"]
    total = em.shape[0] * spf
    for i, (ln, ws) in enumerate(zip(lines, shown)):
        if placed[i]:
            continue
        lo = max([placed[k][-1]["end"] for k in range(i) if placed[k]], default=0.0)
        hi = min([placed[k][0]["start"] for k in range(i + 1, len(lines)) if placed[k]], default=total)
        # keep the window near where the line was heard, so a long instrumental gap can't swallow it
        heard = ln.get("start") or lo
        lo, hi = max(lo, heard - drift), min(hi, (ln.get("end") or heard) + drift)
        if hi - lo < 0.5:
            continue
        a, b = int(lo / spf), int(hi / spf)
        got = _place(ln, ws, _fit(em[a:b], spf, [ws], offset=a * spf)[0], trust * 0.75)
        if got:
            placed[i] = got
    out = []
    for ln, got in zip(lines, placed):
        if got:
            out.append({**ln, "start": got[0]["start"], "end": got[-1]["end"], "words": got, "timing": "aligned"})
        else:
            out.append({**ln, "timing": "heard"})
    return out
