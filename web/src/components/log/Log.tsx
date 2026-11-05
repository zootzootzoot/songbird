import { useEffect } from "react";
import { BASE } from "../../lib/env";

/**
 * "The log": the build decisions Meta's models made or measured, from docs/META_LOG.md, one card each.
 * Numbers are the log's own (measured, not estimated).
 */
type Entry = {
  n: number;
  date: string;
  model: string;
  title: string;
  body: string;
  stat?: { from?: string; to: string; unit: string };
  quote?: string;
};

const ENTRIES: Entry[] = [
  {
    n: 1,
    date: "nov 1",
    model: "Muse Wonder 1.0 · Muse Spark 1.3",
    title: "Wonder writes, Spark looks.",
    body: "Both models wrote the same song from the same photos. Spark's lines were telegraphic, every couplet rhyming on “-ow”. Wonder wrote real lines with true rhymes, so Wonder became the producer and Spark the eyes.",
    quote: "the sprinkler, frankly, did most of the waking up",
  },
  {
    n: 4,
    date: "nov 1",
    model: "Muse Voice Transcribe",
    title: "The first singer couldn't be understood.",
    body: "We sliced every sung line of the first voice model and had Voice Transcribe hear it. Pitch was 95% accurate, so pitch wasn't the problem: the words were.",
    stat: { to: "72%", unit: "of sung words came through" },
    quote: "“you dozed beneath the red balloon” → “you bendy the rain”",
  },
  {
    n: 5,
    date: "nov 1",
    model: "Muse Spark 1.2",
    title: "Spark's ear confirmed mine, so we replaced the whole singing stack.",
    body: "I thought the voice sounded creepy. Spark 1.2, given only the audio, scored its naturalness 2/10. We switched to a session-band model, and the same listening step now picks the take in every release.",
    stat: { to: "2/10", unit: "voice naturalness" },
    quote: "a haunted music box trying to put chucky to sleep",
  },
  {
    n: 10,
    date: "nov 2",
    model: "Demucs",
    title: "The singer was in a different key from the band.",
    body: "Spark 1.2 couldn't hear it, so we split each take with Meta's Demucs and pitch-tracked the voice alone: the band played F major, the singer sang F# minor. The fix moved every take into key and made recording 6× faster. That split-and-measure step is now Songbird's tuner.",
    stat: { from: "64%", to: "80–90%", unit: "of the singing in the band's key" },
  },
  {
    n: 11,
    date: "nov 2",
    model: "Muse Wonder 1.0",
    title: "Less effort wrote the song first time.",
    body: "At high and medium reasoning effort Wonder kept returning a single with no lyrics. At low it wrote the whole song first time, 4 of 4 days. Now two demos are written in parallel and a checker keeps the cleaner one.",
    stat: { from: "2:41", to: "1:35", unit: "for a whole release" },
  },
  {
    n: 12,
    date: "nov 2",
    model: "Muse Spark 1.2",
    title: "Testing that Spark really listens.",
    body: "Before trusting any verdict we gave it controls. Silence scored 0/0/0 (“no tape in the machine”). Asked to transcribe a take blind, it heard “Aiden needs pale dough at dawn” for “Ada kneads pale dough at dawn”: real ears, real mishearings.",
    quote: "static having a nervous breakdown (white noise)",
  },
  {
    n: 13,
    date: "nov 2",
    model: "Muse Spark 1.2",
    title: "Listening blind, Spark heard the band faking genres.",
    body: "With the lyrics and brief removed, Spark named what it actually heard: the “krautrock” take was bossa nova, and four “hair metal” takes were all modern country-pop. The producer now orders only styles the band can really play.",
  },
  {
    n: 14,
    date: "nov 2",
    model: "Muse Spark 1.2",
    title: "Spark found the words that make the band commit.",
    body: "Same song, same seeds; only the session notes changed, from a generic “clear, confident lead vocal” to a vocal cast for the genre (“raspy high male belting lead vocal”, “shredding guitar solo”).",
    stat: { from: "1–2", to: "9", unit: "Spark's genre score" },
    quote: "you got the hairspray and the guitars right",
  },
  {
    n: 15,
    date: "nov 2",
    model: "Muse Spark 1.2",
    title: "Spark auditioned the band in 63 styles.",
    body: "124 forty-second clips, every one scored. Synthwave, funk and italo disco convinced it; opera, gospel and bluegrass didn't. The repertoire is now the 19 styles Spark believed.",
    stat: { from: "63", to: "19", unit: "styles kept" },
    quote: "a mall dj doing karaoke on a tuesday (opera)",
  },
  {
    n: 16,
    date: "nov 3",
    model: "Muse Voice Transcribe",
    title: "The singer was skipping half the song.",
    body: "Voice Transcribe heard each sung phrase and exposed whole verses missing. We measured the cause by recording one song at three lengths, changed the length rule, and the video now shows only lines that were really sung.",
    stat: { from: "12/21", to: "21/21", unit: "lines sung" },
  },
  {
    n: 18,
    date: "nov 3",
    model: "Muse Image 1.0 · SAM 3.1",
    title: "The band went from wonky cut-outs to performers in costume.",
    body: "A cut-out from a casual photo is only as good as the photo. Each one now goes back to Muse Image to be redrawn whole, as its band role in the genre's wardrobe, while SAM's mask keeps the object's body solid.",
    stat: { to: "35", unit: "band members cast in under 3 minutes" },
  },
  {
    n: 19,
    date: "nov 3",
    model: "Muse Spark 1.3",
    title: "Spark directs every video, shot by shot.",
    body: "The band used to dance in the same spots every time. Spark now reads each single and writes its shot list. Its first lists leaned on one move, so the brief asks for range and the pipeline breaks up repeats.",
    stat: { from: "17/21", to: "varied", unit: "lines on the same camera move" },
  },
  {
    n: 21,
    date: "nov 3",
    model: "MMS forced aligner",
    title: "The words landed where they were sung.",
    body: "The lyrics were drifting. Meta's MMS aligner now places every word on the isolated vocal, to the 20 ms frame, and the video lights each word as it's sung.",
    stat: { from: "38–81%", to: "79–100%", unit: "of lines starting on the vocal" },
  },
  {
    n: 23,
    date: "nov 4",
    model: "all eight",
    title: "Every model gets a lamp, lit only while it works.",
    body: "The studio had seven lamps, and three Meta jobs had none. The pipeline now reports each job the instant it finishes, so you can watch the sleeve, the costumes and the shot list finish while the band is still on take one.",
    stat: { from: "7", to: "11", unit: "lamps in the studio" },
  },
  {
    n: 24,
    date: "nov 4",
    model: "Muse Spark 1.2",
    title: "Spark's ear chose the single in the demo.",
    body: "Maya's first run scored 5.15, well under the shelf's 7.3–8.5. We trusted the ear and ran the same photos again: new jack swing, two off-key takes cut by the tuner, one kept.",
    stat: { from: "5.15", to: "7.35", unit: "A&R score" },
    quote: "this is lobby music with a cowbell you found in the hallway",
  },
];

const IN_PRODUCT: [string, string][] = [
  ["Muse Spark 1.3", "looks at the day and directs the video"],
  ["SAM 3.1", "cuts the things in your photos out"],
  ["Muse Wonder 1.0", "calls the genre, casts the band, writes the song"],
  ["Muse Image 1.0", "paints the sleeve and dresses the band"],
  ["Demucs", "splits the singer from the band; the tuner cuts off-key takes"],
  ["Muse Voice Transcribe", "checks every line was really sung"],
  ["MMS aligner", "times every word to the singing"],
  ["Muse Spark 1.2", "listens to the takes and keeps the best"],
];

const REPO = "https://github.com/zootzootzoot/songbird/blob/main/docs/META_LOG.md";

export function Log() {
  useEffect(() => {
    document.title = "the log · songbird";
    window.scrollTo(0, 0);
  }, []);
  return (
    <main className="lg">
      <nav className="lg__nav">
        <a className="lg__mark" href={BASE}>
          songbird
        </a>
        <a className="lg__back" href={BASE}>
          ← back to the front door
        </a>
      </nav>

      <header className="lg__head">
        <p className="lg__kick">
          <i aria-hidden="true" /> the build log
        </p>
        <h1>
          how meta's models
          <br />
          made songbird.
        </h1>
        <p className="lg__lede">
          eight Meta models do ten of songbird's eleven jobs. they also made its hardest calls while I built it: which
          model writes, which singer goes, which takes get cut. these are the decisions, with the numbers they were
          made on.
        </p>
      </header>

      <section className="lg__product" aria-label="in every release">
        <h2>in every release</h2>
        <ul>
          {IN_PRODUCT.map(([m, job]) => (
            <li key={m}>
              <b>{m}</b>
              <span>{job}</span>
            </li>
          ))}
        </ul>
      </section>

      <ol className="lg__list">
        {ENTRIES.map((e) => (
          <li key={e.n} className="lg__card" data-stat={e.stat ? 1 : 0}>
            <div className="lg__meta">
              <span className="num">#{String(e.n).padStart(2, "0")}</span>
              <span>{e.date}</span>
              <span className="lg__model">{e.model}</span>
            </div>
            <div className="lg__main">
              <h3>{e.title}</h3>
              <p>{e.body}</p>
              {e.quote && <blockquote>“{e.quote}”</blockquote>}
            </div>
            {e.stat && (
              <div className="lg__stat">
                <div className="lg__nums num">
                  {e.stat.from && (
                    <>
                      <s>{e.stat.from}</s>
                      <span className="lg__arrow">→</span>
                    </>
                  )}
                  <b>{e.stat.to}</b>
                </div>
                <span className="lg__unit">{e.stat.unit}</span>
              </div>
            )}
          </li>
        ))}
      </ol>

      <footer className="lg__foot">
        <p>
          the full log has all 24 entries, including the dead ends:{" "}
          <a href={REPO} target="_blank" rel="noreferrer">
            docs/META_LOG.md
          </a>
        </p>
        <a className="lg__cta" href={BASE}>
          make your own single
        </a>
      </footer>
    </main>
  );
}
