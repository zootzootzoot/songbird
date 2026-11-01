"""Meta Model API: Muse Spark (looks, writes), SAM 3.1 (cuts out), Muse Image (paints the cover)."""
from __future__ import annotations

import base64
import io
import json
import re
import time
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageFilter
from meta_sam_parser import decode_mask_to_raster
from meta_sam_parser._types import SegmentationMask

from . import config

_client = httpx.Client(base_url=config.META_BASE, timeout=httpx.Timeout(240, connect=20),
                       headers={"Authorization": f"Bearer {config.META_KEY}"})


def _post(path: str, body: dict, tries: int = 3) -> dict:
    last = None
    for k in range(tries):
        try:
            r = _client.post(path, json=body)
            if r.status_code in (429, 500, 502, 503, 504):
                last = RuntimeError(f"{path} {r.status_code}: {r.text[:300]}")
                time.sleep(2 * (k + 1))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{path} {r.status_code}: {r.text[:500]}")
            return r.json()
        except httpx.TransportError as e:
            last = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"Meta API unavailable: {last}")


def data_url(img: Image.Image, fmt: str = "JPEG", max_side: int = 1280) -> str:
    im = img.convert("RGB") if fmt == "JPEG" else img
    if max(im.size) > max_side:
        im = im.copy()
        im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, fmt, quality=90)
    mime = "jpeg" if fmt == "JPEG" else fmt.lower()
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- Muse Spark

def spark_json(messages: list[dict], schema: dict, name: str, effort: str = "low", model: str | None = None) -> dict:
    """Chat Completions with a strict JSON schema. Returns the parsed object."""
    body = {"model": model or config.SPARK, "messages": messages,
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
            "reasoning_effort": effort}
    j = _post("/chat/completions", body)
    text = j["choices"][0]["message"]["content"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


# ---------------------------------------------------------------- SAM 3.1

_REC = re.compile(r",?([0-9]+)((?:<\|[^|]*\|>)+)")
_TOK = re.compile(r"<\|([A-Za-z][A-Za-z0-9_.-]*)(?:;([^|]*))?\|>")


def _fields(s: str) -> dict:
    out = {}
    for part in (s or "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def sam_segment(img: Image.Image, phrase: str) -> list[dict]:
    """All matches of `phrase`: [{'box': (x1,y1,x2,y2) px, 'conf': float, 'mask': bool HxW at photo size}]."""
    body = {"model": config.SAM, "metadata": {"include_confidence": "true"},
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": phrase},
                {"type": "input_image", "image_url": data_url(img, max_side=max(img.size))}]}]}
    j = _post("/responses", body)
    text = "".join(c.get("text", "") for o in j.get("output", []) for c in o.get("content", []) or [])
    W, H = img.size
    found = []
    for line in text.splitlines():
        m = re.match(r"^<([0-9]+)f(?:;[^>]*)?>(.*)$", line.strip())
        if not m:
            continue
        for rec in _REC.finditer(m.group(2)):
            toks = {name: _fields(f) for name, f in _TOK.findall(rec.group(2))}
            if "box" not in toks or "mask" not in toks:
                continue
            b, mk = toks["box"], toks["mask"]
            fw, fh = float(b.get("w", W)), float(b.get("h", H))
            sx, sy = W / fw, H / fh
            x1, y1, x2, y2 = (float(b[k]) for k in ("x1", "y1", "x2", "y2"))
            dm = re.match(r"([0-9]+),([0-9]+),([!~])(.*)$", mk["data"], re.S)
            mh, mw, enc, payload = int(dm.group(1)), int(dm.group(2)), dm.group(3), dm.group(4)
            raster = decode_mask_to_raster(SegmentationMask(
                encoding="lossless" if enc == "~" else "one_bit", payload=enc + payload, width=mw, height=mh))
            local = np.frombuffer(raster, dtype=np.uint8).reshape(mh, mw).astype(bool)
            # the mask raster covers the box, offset by the mask's own x/y (box-relative)
            ox, oy = int(round(x1 + float(mk.get("x", 0)))), int(round(y1 + float(mk.get("y", 0))))
            full = np.zeros((int(fh), int(fw)), dtype=bool)
            hh, ww = min(mh, int(fh) - oy), min(mw, int(fw) - ox)
            if hh > 0 and ww > 0:
                full[oy:oy + hh, ox:ox + ww] = local[:hh, :ww]
            if (int(fw), int(fh)) != (W, H):
                full = np.array(Image.fromarray(full.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 127
            found.append({"box": (x1 * sx, y1 * sy, x2 * sx, y2 * sy),
                          "conf": float(b.get("c", mk.get("c", 0.5))), "mask": full})
    return found


def cutout(img: Image.Image, phrase: str, max_objects: int = 3) -> tuple[Image.Image, tuple] | None:
    """Cut the hero out as an RGBA sticker cropped to its box. Merges a few confident matches (e.g. two ducks)."""
    found = sam_segment(img, phrase)
    if not found:
        return None
    found.sort(key=lambda f: -f["conf"])
    best = found[0]
    keep = [f for f in found[:max_objects] if f["conf"] >= max(0.4, best["conf"] * 0.75)]
    mask = np.zeros_like(best["mask"])
    for f in keep:
        mask |= f["mask"]
    if mask.sum() < 64:
        return None
    ys, xs = np.nonzero(mask)
    W, H = img.size
    pad = int(0.02 * max(W, H))
    x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x2, y2 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
    alpha = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.8))
    rgba = img.convert("RGB").copy()
    rgba.putalpha(alpha)
    crop = rgba.crop((x1, y1, x2, y2))
    return crop, (x1 / W, y1 / H, x2 / W, y2 / H)


# ---------------------------------------------------------------- Muse Image

def paint(prompt: str, refs: list[Image.Image], size: str = "1024x1024") -> Image.Image:
    """Muse Image: compose a new picture from reference images (edits endpoint), or from text alone."""
    if refs:
        body = {"model": config.IMAGE, "prompt": prompt, "size": size, "output_format": "png",
                "images": [{"image_url": data_url(r, "PNG" if r.mode == "RGBA" else "JPEG", 768)} for r in refs[:10]]}
        j = _post("/images/edits", body)
    else:
        j = _post("/images/generations", {"model": config.IMAGE, "prompt": prompt, "size": size, "output_format": "png"})
    d = j["data"][0]
    if d.get("b64_json"):
        raw = base64.b64decode(d["b64_json"])
    else:
        raw = httpx.get(d["url"], timeout=60).content
    return Image.open(io.BytesIO(raw)).convert("RGB")


# ---------------------------------------------------------------- Muse Voice Transcribe

def transcribe(audio: bytes) -> str:
    """Any browser recording (webm/ogg/mp4/wav) → 16 kHz mono WAV → Muse Voice Transcribe → text."""
    import subprocess
    wav = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                          "-f", "wav", "pipe:1"], input=audio, capture_output=True, check=True).stdout
    req = {"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "sampleRate": 16000}
    r = _client.post("/asr/transcribe", files={"request": (None, json.dumps(req), "application/json"),
                                               "audio": ("note.wav", wav, "audio/wav")})
    if r.status_code >= 400:
        raise RuntimeError(f"transcribe {r.status_code}: {r.text[:300]}")
    return (r.json().get("transcript") or "").strip()
