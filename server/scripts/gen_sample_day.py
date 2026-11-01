"""Generate a sample day of candid phone photos with Muse Image (sample content for the demo shelf)."""
import sys, concurrent.futures as cf
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird import meta
STYLE = ("Candid smartphone photo, natural light, slightly imperfect framing, shallow depth of field, real family "
         "snapshot, no text. The child's face is not visible (seen from behind, cropped, or only hands and feet). ")
DAYS = {
 "city": ["a small child's hand holding a dripping pink ice cream cone on a city sidewalk, afternoon sun",
          "small yellow rain boots jumping into a big puddle on a city street, splash frozen mid-air, grey morning",
          "a toddler seen from behind feeding a crowd of grey pigeons in a town square, breadcrumbs in the air",
          "the window seat of a red double-decker bus, a child's hand pressed on the glass, city blurring past",
          "a child's red balloon tied to a stroller handle at dusk, string lights in the street behind"],
 "beach": ["small hands holding a tiny green crab on a wet sandy beach, morning light",
           "a lopsided sandcastle with a paper flag on top and a yellow plastic bucket beside it, bright midday",
           "a little girl in a striped swimsuit seen from behind running into small foamy waves, sunny",
           "a big blue and white striped beach umbrella flapping in the wind over a towel and a half-eaten sandwich",
           "a child asleep in the back seat wrapped in a towel, sandy feet, orange sunset light through the car window"],
}
day = sys.argv[1]
out = Path(__file__).resolve().parents[1] / "samples" / day
out.mkdir(parents=True, exist_ok=True)
def one(i_p):
    i, p = i_p
    im = meta.paint(STYLE + p, [], size="1024x1024")
    im.save(out / f"photo-{i + 1:02d}.jpg", quality=90)
    return i
with cf.ThreadPoolExecutor(5) as ex:
    print(list(ex.map(one, enumerate(DAYS[day]))))
