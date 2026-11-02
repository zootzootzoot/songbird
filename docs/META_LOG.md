# How Meta models solved problems in Songbird

A running log, kept as we build. **In the product** = runs for every release. **In the build** = we used the model
as a tool to make a decision or to test our own work. Numbers are measured, not estimated.

## In the product

| Step | Model | What it does | Why a Meta model is the right tool |
|---|---|---|---|
| Look | **Muse Spark 1.3** (vision, structured output) | Looks at all photos/clips in one call: names each one's *hero* as a noun phrase SAM can find ("rubber duck", "red balloon"), what happened, 3 sensory details, time of day, and orders the day | One multimodal call sees the whole day at once, so it can order it (wet hair → bath is evening) and pick what a child would point at |
| Cast | **SAM 3.1** (image) | Cuts each hero out as a clean sticker, from Spark's noun phrase. ~1–2 s per photo | Spark → SAM is a model-to-model handoff: one model decides *what* matters, the other cuts exactly that |
| Cast | **SAM 3.1** (video) | For a clip, tracks the hero through every frame → an animated sticker that moves (45 frames in 3.5 s) | Text-prompted video tracking turns a parent's 3-second phone clip into a moving band member |
| Produce | **Muse Wonder 1.0** (structured output) | Picks the genre with conviction, writes the session notes, the lyrics (every verse line tied to a photo), band credits, liner notes. A mechanical checker (syllables, photo coverage, chorus repeats, banned clichés) sends it back until it passes | Wonder writes better songs than Spark (see build log); the checker loop makes it reliable |
| Hear your note | **Muse Voice Transcribe** | A parent holds the mic and says one thing the photos can't show ("he named the snail gary"); it ends up in the song ("you named the snail Gary that day") | Turns a 5-second voice note into the most personal line of the song |
| Tune | **Demucs** (Meta FAIR, open weights; Hybrid Demucs via torchaudio) | Splits every take into singer and band, then our tuner checks how much of the singing sits on the band's scale; takes under 75% are cut before anyone hears them | The off-key problem was invisible until the voice could be heard apart from the band (see build log 10) |
| A&R | **Muse Spark 1.2** (audio in) | Listens to every take that passed the tuner and scores voice, words and genre, with a one-line verdict; the best take is kept | Audio understanding lets the label judge its own output instead of shipping the first take |
| Sleeve | **Muse Image 1.0** (edits, references) | Redraws the day's SAM stickers as a three-ink riso record sleeve in the genre's style (~15 s, $0.01) | Multi-reference edits: the cover is made *from that day's actual objects*, not from a text prompt |

## In the build

1. **Choosing the lyricist (Nov 1).** We had Muse Spark 1.3 and Muse Wonder 1.0 write the same song from the same
   look. Spark's lines were telegraphic, with every couplet rhyming on "-ow" ("you peeped at duck in warm foam").
   Wonder wrote real iambic lines with true rhymes and a funny liner note ("the sprinkler, frankly, did most of the
   waking up"). → **Wonder writes, Spark looks.**
2. **Proving SAM's mask format.** The docs didn't describe the mask payload; we probed SAM 3.1 live (snail: box +
   0.96 confidence in 1.6 s), found the box-relative raster, and decoded it with Meta's `meta_sam_parser`.
3. **Finding the transcription request format.** Muse Voice Transcribe's reference page was missing; we probed the
   endpoint and its own error messages taught us the shape (`request` + `audio` parts, `audioEncoding: "WAV"`).
4. **Measuring our first singer's intelligibility with Muse Voice Transcribe.** We sliced every sung line of the
   SoulX-Singer version and had Voice Transcribe hear it: only **72%** of words came through; "you dozed beneath the
   red balloon" was heard as "you bendy the rain". Pitch accuracy was 95% within a semitone, so pitch was clearly
   not the problem.
5. **Muse Spark 1.2 as our critic: it confirmed the owner's ear.** The owner said the SoulX vocal sounded "creepy
   and wispy". We gave Spark 1.2 the audio and asked a blunt producer's opinion: *"Voice naturalness 2/10 … 100%
   uncanny valley."* Later: *"a haunted music box trying to put chucky to sleep."* That verdict is why we replaced
   the whole singing stack with a session-band model (ACE-Step 1.5).
6. **Choosing the new engine by listening.** Spark 1.2 scored the candidate ACE-Step takes (folk / soul / kids)
   against the old SoulX take (voice 6/10 for the best ACE take vs 2/10 for SoulX). The same listening step now runs
   inside the product to pick between takes.
7. **Learning Spark 1.2's audio limits.** With a strict JSON schema plus audio input, Spark 1.2 returned nonsense
   scores; in free text it was coherent and sharp. We switched the A&R step to a fixed plain-text format we parse.
8. **Sample content.** Two of the sample days (city, beach) were generated with Muse Image as candid phone-style
   photos, so the shelf could be tested on varied days without using anyone's real family photos.
9. **First full release on the new pipeline (SB-0001, Nov 1).** Muse Wonder called the city day a "1974
   philadelphia soul symphonic epic" and cast the band ("the pigeon: seed inspector", "the red balloon: high harmony,
   tied to the chair"). ACE-Step recorded two takes; Muse Spark 1.2 listened and kept take 0 (voice 6, words 8) over
   take 1 (voice 3): *"honey this ain't philly soul it's hold music with a robot doing karaoke night."* Muse Image
   painted the sleeve from SAM's cutouts of the boots, pigeons, ice cream and balloon. Total ≈ 2.5 minutes.
10. **The singer was in a different key from the band, and Meta's Demucs proved it (Nov 2).** The owner heard SB-0001
    as "strangely out of key with the beat". Muse Spark 1.2 did not: it gave that exact take its best voice score (7).
    So we split the takes with Meta's open-weight Hybrid Demucs and pitch-tracked the vocal alone. The band played the
    F major the producer asked for, but the vocal sat in **F# minor**, with only **64%** of the singing on the band's
    scale (calibration: our old score-driven vocals measure 0.93-0.96, a reference mix 0.83). Tuning drift was near
    zero, so this was not a detuned singer but a melody written in the wrong key. A four-way trial found the cause:
    ACE-Step's 5Hz LM writes the melody as audio codes while the DiT renders the band in the requested key, and the two
    disagree on every take. With the LM planning only the metadata, all takes measured **0.80-0.90** in key, and
    recording got **6x faster** (12 s for two takes instead of 80 s). The split-and-measure step now ships as the
    label's tuner: the band records four takes, Demucs cuts the off-key ones, and Spark 1.2 judges taste among the rest.
    First release through it (SB-0002): four takes at 85-90% in key; Spark kept take 3 (voice 7, words 8).
11. **Muse Wonder's effort setting (Nov 2).** Every release spent 47-60 s on a first draft that came back with no
    lyrics at all, then another 40-60 s on a send-back round whose rewritten "why" leaked meta-talk ("unfollow
    whatever I said about this before"). Probing the first draft directly: at `reasoning_effort` high and medium,
    Wonder returned the single with an empty `sections` array every time; at low it wrote the whole song first time in
    22-28 s (4 of 4 on four different days passed the checker). It still drops the sections about 1 time in 4, so the
    producer now writes two demos in parallel and the checker keeps the cleaner one. Producing went from ~100 s to
    ~30 s, and a whole release from 2 min 41 s to 1 min 35 s.
12. **Checking that Spark 1.2 really listens (Nov 2).** One prompt made Spark 1.2 claim it "cannot hear audio", so we
    tested its ears with controls before trusting any verdict: silence scored 0/0/0 ("no tape in the machine"), white
    noise was "static having a nervous breakdown", and asked to transcribe a take with no lyric sheet it heard "Aiden
    needs pale dough at dawn" for "Ada kneads pale dough at dawn". Real ears, real mishearings. The refusal was the
    prompt's wording, not the model.
13. **Spark 1.2, listening blind, showed the band could not play the genres the producer ordered (Nov 2).** With the
    lyrics and the brief removed (and on Demucs's band-only stem), Spark named what it actually heard: the "1971
    düsseldorf krautrock" take was "1960s bossa nova, soft brushed groove"; four "1986 arena hair metal" takes were all
    "modern country-pop, early 2020s Suno-style". That sent us into ACE-Step's own training vocabulary: "krautrock",
    "philly soul" and "tropicalia" appear zero times, synth-pop 6,634 times. The producer now picks a playable `style`
    from the band's repertoire (60 styles the band knows) and leads the session notes with it.
14. **Spark 1.2 found the words that make the band commit (Nov 2).** Even in a style it knew, the band played every
    genre gently: the producer's notes asked for "a clear, full, confident lead vocal" every time, which is a generic
    pop singer. Same song, same seeds, only the session notes changed to cast the vocal for the genre ("raspy high
    male belting lead vocal", "shredding guitar solo", "glam metal"): Spark's genre score went from 1-2 to 9, 8, 3, 9
    ("you got the hairspray and the guitars right"). The producer now casts the vocal for every genre and leads and
    closes its notes with the style word.
15. **Spark 1.2 auditioned the session band in 63 styles (Nov 2).** Instead of guessing what the band could play, it
    recorded one 40-second clip per style with the same neutral lyric (two seeds each, 124 clips, ~4 s of GPU per
    clip) and Spark 1.2 scored every one. Synthwave (8.0), funk (7.0), italo disco (7.0), hard rock and big band (6.5)
    convinced it; opera ("a mall dj doing karaoke on a tuesday"), gospel, trap, k-pop, bluegrass and progressive rock
    scored 1-2, which matched our two weakest releases (bluegrass, prog) exactly. The repertoire is now the 19 styles
    Spark believed, and each session the producer gets a random ten of them, so the label's catalogue stays varied.
    First releases after: "1979 two-tone ska revival" (kept take voice 7, words 8, genre 7), "1987 arena power ballad",
    "1930s golden-age argentine tango".

