"""Generate the sample days for the shelf with Muse Image: nine adults, nine kinds of day, candid phone photos.

Each day is saved as samples/<slug>/photo-NN.jpg plus day.json (whose day it was, and the note they'd write).
The photos are generated sample content, so the shelf can show real releases without using anyone's real photos.
usage: gen_days.py [slug ...]   (no args = every day not generated yet)
"""
import sys, json, concurrent.futures as cf
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import meta

STYLE = ("Candid smartphone photo taken by the person whose day it is, natural available light, slightly imperfect "
         "framing, real everyday snapshot, not staged, not an advert, no watermark. Any people are adults, seen from "
         "behind, cropped, or only hands and feet. ")

DAYS = {
 "first-day": {"name": "maya", "note": "first day at the new job. didn't get lost once. ok, once.", "photos": [
    "a brand-new staff ID badge on a lanyard lying on a clean white desk next to a small potted cactus, morning light",
    "a hand holding an oat latte in a paper cup on a crowded commuter train at 7am, window light",
    "a row of glowing lift buttons in an office lobby, a finger pressing floor 14",
    "a new laptop covered in fresh stickers on a desk, a welcome card beside it, monitor glow",
    "four hands clinking glasses on an office rooftop at dusk, city skyline behind"]},
 "moving-day": {"name": "theo", "note": "moved out of the old place. four flights, no lift.", "photos": [
    "stacked cardboard boxes in a narrow hallway, one labelled 'KITCHEN??' in marker",
    "the open back of a small rented moving van on a street, a sofa wedged inside",
    "a bare mattress on the floor of an empty room with long golden sunset light from a window",
    "an open pizza box on the bare wooden floor of an empty flat, takeaway dinner, two cans of lemonade",
    "a single new house key on a plain keyring resting in an open palm"]},
 "half-marathon": {"name": "priya", "note": "first half marathon. 2:14. legs are gone.", "photos": [
    "running shoes being laced on a doorstep at dawn, blue light",
    "a race bib with four safety pins pinned on a running vest, number 2041",
    "crushed paper water cups scattered on a road during a city race, runners' feet blurred",
    "a finisher medal held up in a sweaty hand against the sky",
    "a tall stack of pancakes with berries and syrup on a cafe table, a medal lying beside the plate"]},
 "bakery-nights": {"name": "jonas", "note": "night shift at the bakery. six hundred croissants. first tram home.", "photos": [
    "trays of raw croissants lined up on a steel rack in a bakery at 3am, fluorescent light",
    "the orange glow through the window of a deck oven, loaves inside",
    "a flour-dusted apron hanging on a hook, a radio on the shelf beside it",
    "a paper bag of warm croissants on the seat of an empty early-morning tram",
    "pale pink sunrise over rooftops seen from a tram window"]},
 "rain-sunday": {"name": "sol", "note": "did absolutely nothing. it rained all day.", "photos": [
    "rain streaking down a window, blurred grey street beyond, a houseplant on the sill",
    "a record spinning on a turntable, the sleeve leaning against it",
    "a ginger cat asleep on a knitted blanket on a sofa",
    "a mug of tea steaming on a windowsill next to an open paperback",
    "a clothes horse of drying socks and t-shirts beside a radiator"]},
 "the-wedding": {"name": "kemi", "note": "dami got married. i cried at the speech and again at the cake.", "photos": [
    "a pair of high heels kicked off under a wedding table, tablecloth and fairy lights",
    "a three-tier white wedding cake with fresh flowers, guests' hands holding phones up",
    "gold confetti on a dance floor under coloured party lights",
    "a disposable camera and a half-full champagne glass on a table among petals",
    "city lights streaking past a taxi window at 2am, a corsage on the seat"]},
 "pitch-day": {"name": "dev", "note": "spilled coffee on my laptop twenty minutes before the pitch. pitched anyway.", "photos": [
    "coffee spilled across a laptop keyboard on a cafe table, napkins everywhere",
    "the counter of a small phone and laptop repair shop, tools and tiny screws",
    "a yellow sticky note reading 'BACKUP??' stuck on a phone screen",
    "a wet train platform in drizzle, a person's trainers at the yellow line",
    "a steaming bowl of ramen on a counter at night, chopsticks resting on top"]},
 "lisbon-solo": {"name": "lena", "note": "first solo trip. lisbon. not coming back.", "photos": [
    "a yellow vintage tram climbing a steep cobbled street in Lisbon, morning sun",
    "a custard tart pastel de nata on a small plate with a cup of espresso",
    "blue and white painted azulejo tiles on an old building wall",
    "the railing of a ferry crossing a wide river at sunset, gulls",
    "colourful tins of sardines stacked in a shop window"]},
 "allotment": {"name": "ruth", "note": "seventy-four today. spent it at the allotment, as you do.", "photos": [
    "an old pair of wrinkled hands holding freshly picked tomatoes in an allotment",
    "a battered transistor radio on an upturned crate in a garden shed",
    "a green metal watering can beside rows of runner beans on canes",
    "a folded newspaper crossword, a pencil and a flask of tea on a garden bench",
    "a birthday cake with a single candle on a garden table, garden gloves beside it"]},
}

root = Path(__file__).resolve().parents[1] / "samples"


def one(job):
    slug, i, p = job
    out = root / slug / f"photo-{i + 1:02d}.jpg"
    if out.exists():
        return
    for attempt in range(3):
        try:
            meta.paint(STYLE + p, [], size="1024x1024").save(out, quality=90)
            print(f"  {slug} {i + 1}", flush=True)
            return
        except Exception as e:
            print(f"  {slug} {i + 1} failed ({attempt}): {str(e)[:120]}", flush=True)


slugs = sys.argv[1:] or list(DAYS)
jobs = []
for s in slugs:
    d = DAYS[s]
    (root / s).mkdir(parents=True, exist_ok=True)
    (root / s / "day.json").write_text(json.dumps({"name": d["name"], "note": d["note"]}, indent=1))
    jobs += [(s, i, p) for i, p in enumerate(d["photos"])]
with cf.ThreadPoolExecutor(6) as ex:
    list(ex.map(one, jobs))
print("done", flush=True)
