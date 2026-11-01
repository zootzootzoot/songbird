/**
 * Songbird: the words and the sample roll.
 *
 * Everything here is placeholder content for the working object: six photographs
 * from a day, and the lines the deck "sings" while it reads them. Swapping this
 * file for a real recording is the whole of the later integration.
 */

export type SamplePhoto = {
  src: string;
  alt: string;
  /** short, printed under the thumbnail on the J-card */
  note: string;
};

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  { src: "/assets/photos/photo-01.jpg", alt: "flour on a pair of small hands", note: "4:20" },
  { src: "/assets/photos/photo-02.jpg", alt: "bare feet in the sprinkler", note: "5:05" },
  { src: "/assets/photos/photo-03.jpg", alt: "asleep against the car window", note: "5:48" },
  { src: "/assets/photos/photo-04.jpg", alt: "the dog asleep by small sneakers", note: "6:30" },
  { src: "/assets/photos/photo-05.jpg", alt: "a snail shell over the clover", note: "7:02" },
  { src: "/assets/photos/photo-06.jpg", alt: "a duck in the bath water", note: "7:35" },
];

export const SONG = {
  title: "flour hands",
  date: "october 26",
  side: "side a",
  kicker: "a song for the end of the day",
  recorded: "recorded at the kitchen table",
  closing: "for the small hours",
  lyrics: [
    "you had flour on your hands",
    "and a leaf stuck in your hair",
    "the dog slept through the whole parade",
    "you asked the moon to wait",
    "so the moon waited, patient as a chair",
    "little socks on the bottom stair",
    "sleep now, bird. i kept the light on",
  ],
};

/** Small dry lines the machine prints while it works. */
export const MACHINE_LINES = {
  empty: "feed me some pictures",
  emptySub: "up to six. tap the tray or drop them in.",
  sampleRoll: "the sample roll",
  labelHint: "write a name",
  working: "give it a minute, it's thinking about the dog",
  workingLater: "that one came out sideways. trying again.",
  hurry: "the lamp hurries it along",
  retake: "retake",
  readout: "reading",
  done: "all done",
  doneSub: "it kept the light on for you",
  play: "press play",
  playing: "playing. the room is warm now.",
  footer: "one tape at a time. keep it in a drawer.",
  tapeWord: "songbird",
  tapeSpec: "c60 · low noise",
  model: "sb-6",
};

export function titleForName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `for ${trimmed}` : "for you";
}
