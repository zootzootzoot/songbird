"""Casting: each object from the day becomes a performer in the band.

SAM 3.1 has already cut the hero out of the photo. Muse Image takes that cut-out and the photo as references and
redraws the same object as its band role in the genre's look (the rubber duck on contrabass in a 1930s pinstripe
suit), whole, on a flat light-grey backdrop. The backdrop is then keyed out, which keeps the costume and instrument
that a noun-phrase mask would leave behind.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

from . import meta

# how each family dresses its band; frames and scenery stay on the sleeve, never on a performer
WARDROBE = {
    "synthwave": "1984 synth-pop stage wear: chrome, neon trim, mirrored shades, keytar energy",
    "italo disco": "1983 Italian disco: sequins, neon, sharp shoulders, glossy",
    "synth-pop": "1982 synth-pop: sharp tailoring, cool minimal styling",
    "eurodance": "1994 eurodance: shiny rave wear, platform boots, bright primary colours",
    "funk": "1975 funk: wide lapels, platform shoes, afro wig or fur hat, flared everything",
    "soul": "1970 soul revue: matching sharp suits, satin, gold",
    "big band": "1940s big band: white dinner jacket, bow tie, brass gleaming",
    "bossa nova": "1963 bossa nova: linen suit, loafers, nylon-string cool",
    "rock and roll": "1957 rock and roll: drape jacket, quiff, two-tone shoes",
    "rockabilly": "1956 rockabilly: rolled jeans, leather, slick quiff, upright bass swagger",
    "surf rock": "1963 surf band: matching striped shirts, sunglasses, reverb-drenched guitar",
    "power ballad": "1987 arena power ballad: big hair, a long coat in the wind machine, a dramatic stage stance",
    "hard rock": "1986 glam metal: studded jacket, big teased hair, bandana, pointy guitar",
    "indie rock": "1994 indie: thrift-store cardigan, scuffed sneakers, a shy stance",
    "punk": "1977 punk: ripped shirt, safety pins, leather jacket, a sneer",
    "chiptune": "a 1989 video game sprite hero: bold, simple, bright primaries",
    "ska": "1979 2 Tone: black suit, pork-pie hat, skinny tie, checkerboard accents",
    "tango": "1930s Buenos Aires orquesta: pinstripe suit or tuxedo, fedora, slicked hair",
    "salsa": "1974 Fania salsa: wide-collar shirt, bright suit, brass and timbales",
}

PROMPT = (
    "This exact {hero} from the reference photos, cast as a performer in a {genre} band: {job}. Keep it unmistakably "
    "the same {hero} (its shape, colour, texture and quirks) but give it the instrument, outfit, props and stage "
    "pose of that role, full of character, like a star on a classic sleeve. Wardrobe: {wardrobe}. One single figure, "
    "whole and centred with generous space around it, on a perfectly flat, plain, even {backdrop} background "
    "({hexcode}) like a studio colour screen: no frame, no border, no floor, no shadow, no scenery, no splashes "
    "reaching the edge. No text, no people, no human hands or faces."
)


# backdrops to paint on; each performer gets the one farthest from its own colours, so keying never eats the figure
BACKDROPS = [((216, 216, 216), "light grey", "#d8d8d8"), ((0, 177, 64), "chroma-key green", "#00b140"),
             ((24, 48, 220), "deep blue", "#1830dc"), ((228, 0, 228), "magenta", "#e400e4")]


def backdrop_for(ref: Image.Image) -> tuple[tuple[int, int, int], str, str]:
    a = np.asarray(ref.convert("RGBA")).reshape(-1, 4).astype(np.float32)
    px = a[a[:, 3] > 128][:, :3] if (a[:, 3] > 128).sum() > 500 else a[:, :3]
    px = px[:: max(1, len(px) // 4000)]
    score = lambda c: np.percentile(np.sqrt(((px - np.array(c[0])) ** 2).sum(-1)), 3)
    return max(BACKDROPS, key=score)


def key_out(img: Image.Image, tol: float = 38.0, keep_mask: np.ndarray | None = None) -> Image.Image | None:
    """Remove the flat backdrop: pixels near the border colour that connect to the border become transparent.
    keep_mask (e.g. SAM's mask of the object) is never removed."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    near = np.sqrt(((a - bg) ** 2).sum(-1)) < tol
    hsv = np.asarray(img.convert("RGB").convert("HSV")).astype(np.float32)
    bh, bs, _ = np.asarray(Image.new("RGB", (1, 1), tuple(int(x) for x in bg)).convert("HSV")).reshape(3).astype(np.float32)
    if bs > 120:  # a coloured screen: its shadows and reflections share its hue, whatever their brightness
        dh = np.abs(hsv[..., 0] - bh)
        dh = np.minimum(dh, 255 - dh)
        near |= (dh < 14) & (hsv[..., 1] > 90) & (hsv[..., 2] > 40)
    lab, _ = ndimage.label(near)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    back = np.isin(lab, edge[edge > 0])
    fig = ~back
    lab2, n = ndimage.label(fig)  # keep the figure, drop stray specks
    if not n:
        return None
    sizes = ndimage.sum(fig, lab2, range(1, n + 1))
    keep = np.isin(lab2, 1 + np.flatnonzero(sizes >= 0.02 * sizes.max()))
    if keep_mask is not None and keep_mask.shape == keep.shape:
        keep |= keep_mask & ~near  # SAM's mask overshoots a little; never let it pull the backdrop back in
    # the backdrop was picked to contrast with the object, so any backdrop-coloured pixel, even a pocket the figure
    # encloses (between an arm and a sax), is backdrop
    keep = ndimage.binary_fill_holes(keep) & ~near
    if keep.mean() < 0.02:
        return None
    fringe = np.sqrt(((a - bg) ** 2).sum(-1)) < tol * 2.2
    keep &= ~(fringe & ~ndimage.binary_erosion(keep, iterations=3))
    alpha = Image.fromarray((ndimage.binary_erosion(keep, iterations=1) * 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
    out = img.convert("RGBA")
    out.putalpha(alpha)
    ys, xs = np.nonzero(keep)
    pad = 6
    return out.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad),
                     min(a.shape[0], ys.max() + pad)))


def performer(photo: Image.Image, cut: Image.Image | None, hero: str, role: str, genre: str, style: str | None,
              ) -> tuple[Image.Image, Image.Image] | None:
    """-> (the performer, RGBA and tightly cropped; the raw painting) or None."""
    refs = [photo.convert("RGB")]
    if cut is not None:
        white = Image.new("RGBA", cut.size, (255, 255, 255, 255))
        refs.insert(0, Image.alpha_composite(white, cut.convert("RGBA")).convert("RGB"))
    job = role.split(":", 1)[1].strip() if ":" in role else role
    _, backdrop, hexcode = backdrop_for(cut if cut is not None else photo)
    prompt = PROMPT.format(hero=hero, genre=genre, job=job, backdrop=backdrop, hexcode=hexcode,
                           wardrobe=WARDROBE.get(style or "", f"what a {genre} band would really wear"))
    try:
        art = meta.paint(prompt, refs, size="1024x1024")
    except RuntimeError as e:  # Muse Image's filter refused a wardrobe once; the plain brief still dresses the band
        if "content" not in str(e):
            raise
        art = meta.paint(PROMPT.format(hero=hero, genre=genre, job="a member of the band", backdrop=backdrop,
                                       hexcode=hexcode, wardrobe=f"a smart stage outfit for a {genre} band"),
                         refs, size="1024x1024")
    body = None
    try:  # SAM finds the object itself inside its costume, so its body is never keyed away
        found = meta.sam_segment(art.convert("RGB"), hero)
        if found:
            body = np.zeros(found[0]["mask"].shape, bool)
            for f in found:
                body |= f["mask"]
    except Exception:
        pass
    fig = key_out(art, keep_mask=body)
    return (fig, art) if fig is not None else None
