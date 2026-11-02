/** Every line of machine copy. Lowercase, short, dry, warm. */

export const COPY = {
  masthead: "songbird",
  mastheadLine: "a tape deck for small days",
  emptyCta: "feed me some pictures",
  emptySub: "three to six from today. drop them on the strip, or tap here.",
  overSub: "let go. it can take them.",
  sampleRoll: "the sample roll",
  fewMore: (n: number) => (n === 0 ? "it needs at least three." : `${n} in. it needs at least three.`),
  ready: (n: number) => `${n} pictures clipped in. pull the lever.`,
  full: "six is the most it holds.",
  labelHint: "a name",
  noteHint: "a line about today, if you like",
  noteLabel: "a note for the machine",
  sending: "threading the tape",
  workingIdle: "the machine is thinking",
  printerIdle: "it prints the words as it writes them",
  done: "all done. press play.",
  playing: "playing",
  stopped: "stopped. press play.",
  tapeSpec: "c60 · low noise",
  model: "sb-6",
  footer: "one tape at a time. keep it in a drawer.",
  errorHead: "the tape snagged",
  retry: "try again",
  shelfFallback: "play one from the shelf",
  shelf: "the shelf",
  shelfOffline: "the machine room is quiet. this one is on the house.",
  singerAsleep: "the singer is asleep tonight. shelf tapes still play.",
  print: "print the j-card",
  copyLink: "copy the link",
  copied: "copied",
};

export const STAGE_SHORT: Record<string, string> = {
  looking: "look",
  cutting: "cut",
  writing: "write",
  composing: "tune",
  singing: "sing",
  mixing: "mix",
  printing: "print",
};

export const STAGE_FALLBACK_LABEL: Record<string, string> = {
  looking: "looking at the pictures",
  cutting: "cutting out the stickers",
  writing: "writing the words",
  composing: "finding the tune",
  singing: "singing it through",
  mixing: "winding the music box",
  printing: "printing the j-card",
};

export function formatTime(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
