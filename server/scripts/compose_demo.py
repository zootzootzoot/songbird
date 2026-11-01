"""Compose a hand-written test song over the sample photos and print the score."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from songbird.compose import PlannedLine as L, compose, score_text, count_syllables, rhymes

R = "so sleep now, maya, the day is done"
lines = [
    L("you pressed the dough with floury hands", "verse", 0, "rise", "tender", ["I", "IV", "V", "I"]),
    L("the sprinkler sang across the lawn", "verse", 1, "arch", "bright", ["vi", "IV", "I", "V"]),
    L(R, "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]),
    L("the rain ran races down the glass", "verse", 2, "fall", "rainy", ["vi", "iii", "IV", "V"]),
    L("old biscuit dreamed beside your shoes", "verse", 3, "valley", "sleepy", ["I", "vi", "ii", "V"]),
    L(R, "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]),
    L("a snail came riding in your palm", "verse", 4, "arch", "playful", ["I", "V", "vi", "IV"]),
    L("the duck kept watch above the foam", "verse", 5, "rise", "tender", ["IV", "V", "iii", "vi"]),
    L(R, "refrain", None, "fall", "sleepy", ["IV", "I", "V", "I"]),
]
for l in lines: print(count_syllables(l.text), l.text)
song = compose(lines, tonic=65, mode="major", bpm=96, meter=3)
print(score_text(song))
print("duration", song["duration"], song["key"])
out = Path(__file__).resolve().parents[1] / "data" / "compose_demo"
out.mkdir(parents=True, exist_ok=True)
(out / "song.json").write_text(json.dumps({k: v for k, v in song.items()}, indent=1, default=str))
