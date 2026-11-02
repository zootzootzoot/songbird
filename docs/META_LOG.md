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
| A&R | **Muse Spark 1.2** (audio in) | Listens to each recorded take and scores voice, words and genre, with a one-line verdict; the best take is kept | Audio understanding lets the label judge its own output instead of shipping the first take |
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
