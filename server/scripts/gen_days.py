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

# the days behind "borrow someone's day": other people, other days, so a judge who borrows one makes a new single
# instead of re-making one already on the shelf. usage: gen_days.py --borrow
BORROW = {
 "driving-test": {"name": "omar", "note": "passed my driving test on the third try. the examiner nearly smiled.", "photos": [
    "a red L-plate stuck on the rear window of a small hatchback, drizzle on the glass",
    "a hand resting on a gear stick, dashboard and wet windscreen beyond, grey morning",
    "a mini roundabout seen through a car windscreen, wipers mid-sweep",
    "a driving test pass certificate held in one hand against the bonnet of a car, thumb in shot",
    "a drive-through milkshake in a car cupholder at night, dashboard lights glowing"]},
 "power-cut": {"name": "hana", "note": "power cut on the whole street. cooked everything in the freezer before it melted.", "photos": [
    "a row of lit candles in jars on a dark kitchen counter",
    "a camping gas stove on a back step with a frying pan of sizzling dumplings, night",
    "a melting tub of ice cream on a garden wall with several spoons stuck in it",
    "a dark terraced street at night with every window black, one torch beam on the pavement",
    "a board game laid out on a table lit only by a camping lantern, hands reaching in"]},
 "first-gig": {"name": "luca", "note": "first gig with the band. eleven people came. we played the last song twice.", "photos": [
    "a handwritten setlist gaffer-taped to a scuffed stage floor next to a guitar pedal",
    "a bass guitar case and a snare drum squeezed into the boot of a small car",
    "a pint glass of water standing on top of a guitar amp, red stage light",
    "a tiny pub stage seen from the back of the room, warm light, a handful of people's backs",
    "a stack of folded band t-shirts and a cash tin on a trestle table after the show"]},
 "snow-day": {"name": "nadia", "note": "snowed in. office shut. built something that was meant to be a snowman.", "photos": [
    "a row of parked cars buried under thick fresh snow on a quiet street, early light",
    "deep boot prints in untouched snow leading to a front gate",
    "a lopsided small snowman with a carrot nose and a woolly hat in a back garden",
    "wet mittens and a scarf drying on a radiator under a steamed-up window",
    "a mug of hot chocolate piled with marshmallows on a windowsill, snow falling outside"]},
 "coast-ride": {"name": "felix", "note": "cycled to the coast. two punctures, one sea.", "photos": [
    "a road bike leaning on a wooden farm gate on a country lane at sunrise",
    "a punctured inner tube, tyre levers and a mini pump on the grass verge",
    "a white road sign pointing to the coast, 12 miles, cow parsley around it",
    "a bicycle lying on a pebble beach at golden hour, the sea calm behind",
    "a paper tray of fish and chips with a wooden fork on a sea wall, a bike helmet beside it"]},
 "night-ward": {"name": "ines", "note": "twelve hours on the ward. somebody brought doughnuts at 4am.", "photos": [
    "an empty hospital corridor at night, soft blue floor lights, no people",
    "an open box of glazed doughnuts on a break-room table next to a stethoscope",
    "a pair of comfortable clogs beside a staff locker, a lanyard hanging from the door",
    "the glowing front of a hospital vending machine in a dark waiting area",
    "a pink sunrise over a multi-storey car park, seen from a car's driver seat"]},
 "work-karaoke": {"name": "marcus", "note": "work karaoke. said i wouldn't sing. sang three.", "photos": [
    "a karaoke microphone lying on a sticky table under pink and blue neon",
    "a thick laminated karaoke song binder open on a sofa, a finger running down the list",
    "a tray of small glasses of something bright green on a bar counter",
    "a karaoke booth screen glowing with coloured bars, the room dark, people's silhouettes from behind",
    "the top deck of an empty night bus, city lights streaking past the front window"]},
 "thesis-day": {"name": "yuki", "note": "handed the thesis in. three years, two hundred pages, one nap.", "photos": [
    "a thick stack of pages coming out of an office printer, a hand waiting",
    "a freshly bound blue thesis lying on a university reception counter",
    "empty coffee cups and sticky notes crowding a small desk at night, a laptop glowing",
    "a quiet university library at night, rows of desks with green lamps, nobody there",
    "a crumpled duvet on an unmade bed in bright afternoon sun, curtains half open"]},
}
if "--borrow" in sys.argv:
    sys.argv.remove("--borrow")
    DAYS = BORROW

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
