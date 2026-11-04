"""Render the front door's floating objects: one thing from each sample day, redrawn by Muse Image from its photo as a
glossy studio object, then keyed out (cast.key_out). Writes web/public/objects/<slug>-<n>.webp and objects.json.
usage: gen_objects.py [slug-n ...]   (no args = all missing)
"""
import sys, json, concurrent.futures as cf
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import meta, cast

root = Path(__file__).resolve().parents[1]
out = root.parent / "web" / "public" / "objects"
out.mkdir(parents=True, exist_ok=True)

# (day, photo index, the thing, label shown on hover)
OBJECTS = [
    ("first-day", 0, "the office access pass in its clear sleeve on a navy lanyard", "the new badge"),
    ("first-day", 1, "the paper coffee cup", "the 7am latte"),
    ("moving-day", 0, "one cardboard moving box with KITCHEN?? written on it in marker", "box marked kitchen??"),
    ("moving-day", 4, "the house key on its keyring", "the new key"),
    ("half-marathon", 0, "one running shoe", "the left shoe"),
    ("half-marathon", 3, "the finisher medal with its ribbon", "the medal"),
    ("bakery-nights", 3, "the paper bag of croissants", "croissant no. 600"),
    ("bakery-nights", 2, "the vintage transistor radio", "the night radio"),
    ("rain-sunday", 1, "the turntable with the vinyl record on it", "the record player"),
    ("rain-sunday", 2, "the sleeping ginger cat, curled up", "the cat, asleep"),
    ("the-wedding", 0, "one white high-heeled shoe", "the kicked-off heel"),
    ("the-wedding", 3, "the yellow disposable camera", "the disposable camera"),
    ("pitch-day", 4, "the bowl of ramen with chopsticks resting on it", "the consolation ramen"),
    ("pitch-day", 0, "the open laptop", "the laptop, deceased"),
    ("lisbon-solo", 1, "the custard tart pastel de nata", "pastel de nata"),
    ("lisbon-solo", 4, "one colourful tin of sardines", "the sardine tin"),
    ("lisbon-solo", 0, "the yellow tram, as a small detailed model", "tram 28"),
    ("allotment", 0, "three red tomatoes on the vine", "the first tomatoes"),
    ("allotment", 2, "the green metal watering can", "the watering can"),
    ("allotment", 4, "the small birthday cake with one candle", "seventy-four"),
]

PROMPT = ("A photoreal 3D studio render of {thing} from this photo, on its own: the same colours, materials, wear and "
          "details as in the photo, slightly glossy, soft bright daylight, a gentle three-quarter angle as if it is "
          "floating in the air, the whole object in frame with a wide empty margin all around, nothing else in the "
          "picture, no hands, no people, no shadow, no text except what is printed on the object itself. "
          "Background: a perfectly flat plain {bname} ({bhex}) filling the frame.")


def one(i):
    day, k, thing, label = OBJECTS[i]
    name = f"{day}-{sum(1 for o in OBJECTS[:i] if o[0] == day) + 1}"
    dst = out / f"{name}.webp"
    if dst.exists():
        return name
    photo = Image.open(sorted((root / "samples" / day).glob("photo-*.jpg"))[k]).convert("RGB")
    rgb, bname, bhex = cast.backdrop_for(photo)
    for attempt in range(3):
        try:
            art = meta.paint(PROMPT.format(thing=thing, bname=bname, bhex=bhex), [photo])
            fig = cast.key_out(art)
            if fig is None:
                print(f"  {name}: key-out failed ({attempt})", flush=True)
                continue
            fig = fig.crop(fig.getbbox())
            fig.thumbnail((480, 480))
            fig.save(dst, "WEBP", quality=86, method=6)
            print(f"  {name} ok", flush=True)
            return name
        except Exception as e:
            print(f"  {name} failed ({attempt}): {str(e)[:120]}", flush=True)
    return None


want = sys.argv[1:]
idx = [i for i in range(len(OBJECTS))]
with cf.ThreadPoolExecutor(6) as ex:
    names = list(ex.map(one, idx))
manifest = [{"src": f"objects/{n}.webp", "day": OBJECTS[i][0], "label": OBJECTS[i][3]}
            for i, n in enumerate(names) if n]
(out / "objects.json").write_text(json.dumps(manifest, indent=1))
print("done", len(manifest), flush=True)
