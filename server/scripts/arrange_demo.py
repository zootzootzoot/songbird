"""Exercise and measure the arranger (songbird/arrange.py).

  .venv\\Scripts\\python.exe scripts\\arrange_demo.py [--quick]

1. Rebuilds the film lullaby (film/tools/song.py) as a comp: 2 intro bars, the 24 sung bars, 4 outro bars,
   at the film's 120 bpm 3/4, and mixes it with film/public/audio/vocal.wav (shifted so line 1 lands on
   beat 0 of bar 2). One mix per palette.
2. Renders instrumental-only variants (meter 4, minor, rainy, playful, each palette, a long 60-bar stress case).
3. Measures everything: duration, LUFS, sample/true peak, NaN/clipping, render time, per-section RMS / spectral
   centroid / onset rate, intro box pitches vs the melody, the outro ritardando and pitch droop, the end click
   and the tail, and writes a spectrogram PNG (log frequency, RMS strip, section markers) per render.

Writes to server/data/arrange_demo/.
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = SERVER.parent
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(ROOT / "film" / "tools"))

from songbird import arrange  # noqa: E402

OUT = SERVER / "data" / "arrange_demo"
SR = 44100


# ------------------------------------------------------------------------------------------- comps

def lullaby_comp(palette="musicbox", energy=.35, brightness=.5):
    import song
    intro, M = 2, 3
    names = [c for line in song.LINES for c in line["chords"]]
    pre, post = ["F", "C"], ["F", "F", "Bb", "F"]

    def tones(name):
        root, tri = song.CHORDS[name]
        return [root] + sorted({t for t in tri if t % 12 != root % 12})

    bars = [{"chord": n, "tones": tones(n)} for n in pre + names + post]
    melody = [{"beat": intro * M + b, "dur": d, "midi": m} for line in song.LINES for b, d, m, _, _ in line["notes"]]
    sections = [
        {"kind": "intro", "bar": 0, "bars": 2, "mood": "tender"},
        {"kind": "verse", "bar": 2, "bars": 8, "mood": "tender"},
        {"kind": "verse", "bar": 10, "bars": 8, "mood": "bright"},
        {"kind": "refrain", "bar": 18, "bars": 8, "mood": "sleepy"},
        {"kind": "outro", "bar": 26, "bars": 4, "mood": "sleepy"},
    ]
    return {"bpm": song.BPM, "meter": M, "key": {"tonic": 65, "mode": "major"}, "bars": bars, "sections": sections,
            "melody": melody, "style": {"energy": energy, "brightness": brightness, "palette": palette},
            "total_beats": len(bars) * M}


def synth_comp(bpm=92, meter=4, tonic=62, mode="major", palette="felt-piano", moods=("tender", "bright", "tender", "sleepy"),
               energy=.45, brightness=.5, verse_bars=8, seed=1):
    """A plausible composer output: intro 2, then verse/refrain pairs, outro 4, one chord per bar, simple melody."""
    rng = np.random.default_rng(seed)
    M = meter
    deg = [0, 9, 5, 7] if mode == "major" else [0, 8, 3, 10]  # I vi IV V  /  i VI III VII
    qual = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]] if mode == "major" else [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]
    names_maj = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    kinds = ["verse", "refrain"] * ((len(moods) + 1) // 2)
    plan = [("intro", 2, moods[0])] + [(kinds[i], verse_bars, md) for i, md in enumerate(moods)] + [("outro", 4, moods[-1])]
    bars, sections, melody = [], [], []
    b0 = 0
    prev = 67
    for kind, nbars, mood in plan:
        sections.append({"kind": kind, "bar": b0, "bars": nbars, "mood": mood})
        for k in range(nbars):
            i = k % 4
            root = 45 + (tonic + deg[i] - 45) % 12
            tn = [root + q for q in qual[i]]
            nm = names_maj[root % 12] + ("m" if qual[i][1] == 3 else "")
            bars.append({"chord": nm, "tones": tn})
            if kind in ("verse", "refrain"):
                pcs = [t % 12 for t in tn]
                cands = [p for p in range(60, 76) if p % 12 in pcs]
                rhythm = ([2, 1] if M == 3 else [1, 1, 2]) if k % 4 != 3 else [M - 1]
                beat = (b0 + k) * M
                for d in rhythm:
                    p = min(cands, key=lambda c: abs(c - prev) + (3 if c == prev else 0) + rng.uniform(0, 3))
                    melody.append({"beat": float(beat), "dur": float(d), "midi": int(p)})
                    prev, beat = p, beat + d
        b0 += nbars
    return {"bpm": bpm, "meter": M, "key": {"tonic": tonic, "mode": mode}, "bars": bars, "sections": sections, "melody": melody,
            "style": {"energy": energy, "brightness": brightness, "palette": palette}, "total_beats": len(bars) * M}


# ------------------------------------------------------------------------------------------- measuring

def lufs(x):
    return arrange._loudness(x, SR)


def stft_mag(x, n=4096, hop=512):
    w = np.hanning(n)
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (0, n)), n)[::hop]
    return np.abs(np.fft.rfft(frames * w, axis=1)), np.fft.rfftfreq(n, 1 / SR), hop


def midi_of(f):
    return 69 + 12 * np.log2(f / 440)


def pitch_after(x, t, lo=500, hi=4500, n=8192, expect=None):
    """Dominant newly-arrived partial right after an onset (positive spectral difference), in MIDI."""
    a, b = int((t + .015) * SR), int((t - .005) * SR) - n
    if b < 0 or a + n > len(x):
        return None
    w = np.hanning(n)
    f = np.fft.rfftfreq(n, 1 / SR)
    post = np.abs(np.fft.rfft(x[a:a + n] * w))
    pre = np.abs(np.fft.rfft(x[b:b + n] * w))
    if expect is not None:  # accompaniment tines struck with it sit lower: ignore anything a tritone or more below
        lo = max(lo, 440 * 2 ** ((expect - 6 - 69) / 12))
    d = np.where((f >= lo) & (f <= hi), np.maximum(post - pre, 0), 0)
    # lowest strong new partial = the fundamental (a tine's fundamental is its strongest partial; for a re-struck
    # pitch that is still ringing, phase cancellation can weaken it, hence the 25% threshold rather than argmax)
    pk = np.where((d[1:-1] > d[:-2]) & (d[1:-1] >= d[2:]) & (d[1:-1] >= .25 * d.max()))[0] + 1
    k = int(pk[0]) if len(pk) else int(np.argmax(d))
    if 0 < k < len(d) - 1:  # parabolic interpolation on log magnitude
        y0, y1, y2 = np.log(post[k - 1:k + 2] + 1e-12)
        k = k + .5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
    return float(midi_of(k * SR / n))


def onsets(x, t0, t1, lo=600, hi=5000):
    """Spectral-flux onsets (seconds) in [t0, t1]."""
    seg = x[int(t0 * SR):int(t1 * SR)]
    S, f, hop = stft_mag(seg, 1024, 256)
    band = (f >= lo) & (f <= hi)
    L = np.log1p(S[:, band] * 50)
    flux = np.maximum(np.diff(L, axis=0), 0).sum(1)
    thr = np.median(flux) + 2.5 * np.std(flux)
    pk = [i for i in range(1, len(flux) - 1) if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] > flux[i + 1]]
    out = []
    for i in pk:
        t = t0 + (i + 1) * hop / SR
        if not out or t - out[-1] > .08:
            out.append(t)
    return out


def section_stats(x, info, total):
    mono = x.mean(1)
    rows = []
    secs = info["sections"]
    for i, s in enumerate(secs):
        a = s["t"]
        z = secs[i + 1]["t"] if i + 1 < len(secs) else min(total, len(mono) / SR)
        seg = mono[int(a * SR):int(z * SR)]
        if len(seg) < SR // 4:
            continue
        S, f, _ = stft_mag(seg, 2048, 1024)
        pw = (S ** 2).sum(0)
        hi = f >= 150  # ignore the bass so the tone of the arpeggio/box/pad shows
        cent = float((pw[hi] * f[hi]).sum() / (pw[hi].sum() + 1e-12))
        hf = float(10 * np.log10(pw[f >= 2000].sum() / (pw.sum() + 1e-12)))
        on = onsets(mono, a, z)
        rows.append({"kind": s["kind"], "mood": s["mood"], "t": round(a, 2), "len_s": round(z - a, 2),
                     "rms_db": round(float(10 * np.log10(np.mean(seg ** 2) + 1e-12)), 1),
                     "centroid_hz": round(cent), "hf_db": round(hf, 1), "onsets_per_s": round(len(on) / (z - a), 2)})
    return rows


def basic(x):
    return {"duration_s": round(len(x) / SR, 2), "lufs": round(lufs(x.T), 2),
            "sample_peak_dbfs": round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 2),
            "true_peak_dbtp": round(arrange.true_peak_db(x.T, SR), 2),
            "nan": int(np.isnan(x).sum()), "clipped_samples": int((np.abs(x) >= .999).sum())}


def decode_mp3(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "pipe:1"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, "<f4").reshape(-1, 2).astype(np.float64)


def check_intro(x, comp, info):
    """Box notes in the intro vs the first sung phrase: pitch class must match the melody, transposed by box_shift."""
    mono = x.mean(1)
    mel = sorted(comp["melody"], key=lambda n: n["beat"])
    res = []
    for t, m, k in info["intro_notes"]:
        exp = mel[k]["midi"] + info["box_shift"]  # the sung note this box note quotes, an octave (or two) up
        got = pitch_after(mono, t, expect=exp)
        rep = k > 0 and mel[k - 1]["midi"] == mel[k]["midi"]
        ok = got is not None and (abs(got - exp) < .5 or (rep and abs((got - exp + 6) % 12 - 6) < .5))
        res.append({"t": round(t, 3), "sung_midi": mel[k]["midi"], "expected_box_midi": exp, "engine_midi": m,
                    "detected_midi": None if got is None else round(got, 2), "restrike_of_same_pitch": rep, "ok": ok})
    if info["intro_notes"]:
        det = onsets(mono, info["intro_notes"][0][0] - .1, info["intro_notes"][-1][0] + .1)
        plan = [n[0] for n in info["intro_notes"]]
        hit = sum(any(abs(d - p) < .04 for d in det) for p in plan)
    else:
        det, hit = [], 0
    return {"notes": res, "all_pitches_ok": all(r["ok"] for r in res) and bool(res),
            "planned_onsets_found_in_audio": f"{hit}/{len(info['intro_notes'])}"}


def check_outro(x, info, spb):
    mono = x.mean(1)
    rows = []
    for t, m, cents, xb in info["outro_notes"]:
        got = pitch_after(mono, t, expect=m)
        rows.append({"t": round(t, 3), "src_beat": xb, "nominal_midi": m, "planned_cents": round(cents, 1),
                     "measured_cents": None if got is None else round((got - m) * 100, 1)})
    ts = [r["t"] for r in rows]
    ioi = np.diff(ts)
    # stretch = seconds per written beat between consecutive notes, relative to the song tempo
    stretch = [round((ts[i + 1] - ts[i]) / ((rows[i + 1]["src_beat"] - rows[i]["src_beat"]) * spb), 2) for i in range(len(rows) - 1)]
    det = onsets(mono, ts[0] - .1, ts[-1] + .1) if ts else []
    found = sum(any(abs(d - t) < .04 for d in det) for t in ts)
    ct = info["click_t"]
    seg = mono[int((ct - .01) * SR):int((ct + .05) * SR)]
    pre = mono[int((ct - .6) * SR):int((ct - .05) * SR)]
    from scipy.signal import butter, sosfilt
    sos = butter(4, [3000, 8000], btype="bandpass", fs=SR, output="sos")
    click_rise_db = 10 * np.log10(np.max(sosfilt(sos, seg) ** 2) / (np.median(sosfilt(sos, pre) ** 2) + 1e-15))
    errs = [abs(r["measured_cents"] - r["planned_cents"]) for r in rows if r["measured_cents"] is not None]
    gross = sum(e > 100 for e in errs)  # another note picked up (pad swell / chord tine), not a tuning error
    errs = [e for e in errs if e <= 100]
    droop_err = round(float(np.median(errs)), 1) if errs and gross <= len(rows) // 2 else 99.0
    tail = mono[-int(.5 * SR):]
    return {"notes": rows, "inter_onset_s": [round(v, 3) for v in ioi], "stretch_vs_tempo": stretch,
            "planned_onsets_found_in_audio": f"{found}/{len(ts)}",
            "ritardando": bool(len(stretch) > 1 and all(b >= a - .01 for a, b in zip(stretch, stretch[1:])) and stretch[-1] > 1.5),
            "droop_median_abs_err_cents": droop_err, "pitch_misdetections": gross, "droop_ok": bool(droop_err < 6 and (rows[-1]["measured_cents"] or 0) < -30),
            "click_t": round(ct, 2), "click_rise_db": round(float(click_rise_db), 1),
            "last_0.5s_rms_dbfs": round(float(10 * np.log10(np.mean(tail ** 2) + 1e-15)), 1)}


# ------------------------------------------------------------------------------------------- PNG

def _png(path, rgb):
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[i].tobytes() for i in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def spectrogram_png(path, x, info, width=1400, height=300, strip=70):
    mono = x.mean(1)
    S, f, hop = stft_mag(mono, 2048, 256)
    db = 20 * np.log10(S + 1e-9)
    edges = np.geomspace(40, 14000, height + 1)
    idx = np.searchsorted(f, edges)
    img = np.stack([db[:, idx[i]:max(idx[i + 1], idx[i] + 1)].max(1) for i in range(height)], 1)  # frames x rows
    cols = np.linspace(0, len(img), width + 1).astype(int)
    img = np.stack([img[cols[i]:max(cols[i + 1], cols[i] + 1)].max(0) for i in range(width)], 0)
    top = img.max()
    v = np.clip((img - (top - 85)) / 85, 0, 1).T[::-1]  # rows (high freq at top) x width
    anchors = np.array([[0, 0, 4], [40, 15, 90], [150, 40, 110], [230, 110, 60], [252, 230, 150]], float)
    pos = np.linspace(0, 1, len(anchors))
    rgb = np.stack([np.interp(v, pos, anchors[:, c]) for c in range(3)], -1)
    # RMS strip (50 ms) in dB, -60..0
    win = int(.05 * SR)
    r = np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, "same"))
    rd = np.clip((20 * np.log10(r + 1e-9) + 60) / 60, 0, 1)
    rc = np.linspace(0, len(rd), width + 1).astype(int)
    rv = np.array([rd[rc[i]:max(rc[i + 1], rc[i] + 1)].max() for i in range(width)])
    st = np.full((strip, width, 3), 18.0)
    hgt = (rv * (strip - 4)).astype(int)
    for i in range(width):
        st[strip - 2 - hgt[i]:strip - 2, i] = (120, 200, 230)
    out = np.concatenate([rgb, np.full((4, width, 3), 60.0), st], 0)
    sec = width / (len(mono) / SR)
    for s in info.get("sections", []):
        c = int(s["t"] * sec)
        if 0 <= c < width:
            out[:, c] = (255, 255, 255)
    for t, *_ in info.get("intro_notes", []):
        c = int(t * sec)
        out[:6, max(0, c - 1):c + 2] = (80, 255, 80)
    for t, *_ in info.get("outro_notes", []):
        c = int(t * sec)
        out[:6, max(0, c - 1):c + 2] = (255, 80, 80)
    if info.get("click_t"):
        c = int(info["click_t"] * sec)
        out[:, max(0, c - 1):c + 1] = (255, 60, 60)
    _png(path, out.clip(0, 255).astype(np.uint8))


# ------------------------------------------------------------------------------------------- main

def instrumental_case(name, comp, report):
    t = time.perf_counter()
    x, info = arrange._render(comp, SR)
    dt = time.perf_counter() - t
    t = time.perf_counter()
    arrange.render_instrumental(comp, SR)
    dt2 = time.perf_counter() - t
    x2 = arrange.render_instrumental(comp, SR)
    sf.write(OUT / f"{name}.wav", x, SR, subtype="PCM_16")
    spectrogram_png(OUT / f"{name}.png", x.astype(np.float64), info)
    secs = comp["total_beats"] * 60 / comp["bpm"]
    r = {"render_s": round(dt, 2), "render_s_warm": round(dt2, 2), "song_s": round(secs, 1),
         "deterministic": bool(np.array_equal(x, x2)), **basic(x.astype(np.float64)),
         "bus_rms_db": info["bus_rms_db"], "sections": section_stats(x.astype(np.float64), info, secs),
         "intro": check_intro(x.astype(np.float64), comp, info), "outro": check_outro(x.astype(np.float64), info, 60 / comp["bpm"])}
    report[name] = r
    print(f"{name:22s} render {dt:5.2f}s (warm {dt2:4.2f}s) for {secs:5.1f}s song -> {r['duration_s']:6.2f}s  "
          f"{r['lufs']:6.2f} LUFS  TP {r['true_peak_dbtp']:6.2f}  intro {r['intro']['planned_onsets_found_in_audio']} "
          f"pitch_ok={r['intro']['all_pitches_ok']}  rit={r['outro']['ritardando']} droop={r['outro']['droop_ok']}")
    return x, info


def main():
    quick = "--quick" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    import song
    vocal, vsr = sf.read(ROOT / "film" / "public" / "audio" / "vocal.wav", dtype="float64")
    shift = song.SONG_BAR * song.BAR - 2 * song.BAR  # film line 1 at bar 32; ours at bar 2
    vocal = vocal[int(round(shift * vsr)):]

    palettes = ["musicbox"] if quick else ["musicbox", "felt-piano", "guitar"]
    for pal in palettes:
        comp = lullaby_comp(pal)
        (OUT / f"lullaby_{pal}.comp.json").write_text(json.dumps(comp, indent=1))
        x, info = instrumental_case(f"lullaby_{pal}_inst", comp, report)
        t = time.perf_counter()
        mp3 = OUT / f"lullaby_{pal}.mp3"
        dur = arrange.mix(comp, vocal, vsr, str(mp3), str(OUT / f"lullaby_{pal}.wav"))
        dt = time.perf_counter() - t
        m, _ = sf.read(OUT / f"lullaby_{pal}.wav", dtype="float64")
        dec = decode_mp3(mp3)
        spectrogram_png(OUT / f"lullaby_{pal}.png", m, info)
        # vocal-on-top check: loudness of the processed vocal vs the bed in the sung span
        sung = (3.0, 3.0 + 73.5 * .5)
        a, z = int(sung[0] * SR), int(sung[1] * SR)
        report[f"lullaby_{pal}_mix"] = {"mix_s": round(dt, 2), "returned_duration": round(dur, 2), "wav": basic(m), "mp3_decoded": basic(dec),
                                        "lufs_sung_span": round(lufs(m[a:z].T), 2), "lufs_intro": round(lufs(m[:int(3 * SR)].T), 2),
                                        "lufs_outro": round(lufs(m[z:].T), 2),
                                        "engine": {k: (round(v, 2) if isinstance(v, float) else [round(u, 2) for u in v])
                                                   for k, v in arrange.last_mix_info.items()}}
        print(f"  mix {pal}: {dt:.2f}s -> {dur:.2f}s  wav {report[f'lullaby_{pal}_mix']['wav']}  mp3 {report[f'lullaby_{pal}_mix']['mp3_decoded']}")

    if not quick:
        variants = {
            "v_meter4_piano":   synth_comp(92, 4, 62, "major", "felt-piano", ("tender", "bright", "tender", "sleepy")),
            "v_minor_guitar":   synth_comp(76, 3, 57, "minor", "guitar", ("tender", "rainy", "tender", "sleepy"), energy=.3),
            "v_rainy_musicbox": synth_comp(84, 4, 60, "major", "musicbox", ("rainy", "rainy", "rainy", "rainy"), energy=.3),
            "v_playful_piano":  synth_comp(112, 4, 67, "major", "felt-piano", ("playful", "playful", "bright", "playful"), energy=.8,
                                           brightness=.7),
            "v_playful_guitar": synth_comp(116, 3, 64, "major", "guitar", ("bright", "playful", "playful", "tender"), energy=.85),
            "v_moods_musicbox": synth_comp(96, 3, 65, "major", "musicbox", ("tender", "bright", "rainy", "playful", "sleepy"), verse_bars=6),
            "v_long60_piano":   synth_comp(70, 4, 63, "major", "felt-piano", ("tender", "bright", "rainy", "playful", "sleepy", "tender"),
                                           verse_bars=9),
            "v_short20_box":    synth_comp(120, 3, 69, "minor", "musicbox", ("sleepy", "tender"), verse_bars=7),
        }
        for name, comp in variants.items():
            (OUT / f"{name}.comp.json").write_text(json.dumps(comp, indent=1))
            instrumental_case(name, comp, report)
    (OUT / "report.json").write_text(json.dumps(report, indent=1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
