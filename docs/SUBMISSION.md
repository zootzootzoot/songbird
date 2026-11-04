# Submission draft

Field by field, for the hackathon form. Every number here is measured (docs/META_LOG.md), nothing estimated.

## Team Name

zoot

## Track

Indie

## Problem statement

(pick from the form's list; see the note at the end)

## Most Viral Track: X post

(link once posted; draft post at the end)

## Project Description

Songbird is a music journal: every day you live becomes a single.

Drop in five photos from today. Songbird looks at the day, calls its genre with total conviction ("1981 new wave of
british heavy metal", for a first half marathon), casts the things in your photos as the band (the running shoe on
galloping lead guitar), writes the song, records four takes, throws out the off-key ones, keeps the best, paints the
sleeve and cuts a music video, directed shot by shot. Two to three minutes, and you get a 9:16 MP4 to send.

The problem: people take more than two trillion photos a year and look back at almost none of them. A camera roll
keeps what a day looked like, but not how it felt. Songs are the memory format people never lose (memories cued by
music are rated more vivid than memories cued by faces, Belfi et al., Memory 2016), and almost nobody can write,
sing, produce and edit a song about their own Tuesday. Songbird turns the most-used, least-revisited archive people
own into something they replay and share: one single per day, a discography per year, kept on your device.

It is a real pipeline, live: eleven jobs, ten of them done by eight Meta models, three on open weights on our own GPU.
You watch it work in a control room where every model is a lamp that lights only while it is actually working, and
everything it decided is on screen: the genre and why, the band roles, each take's tuner reading, the A&R verdict.
Nine sample days are on the shelf, every one made by the same pipeline a visitor's day goes through.

Live: https://zootzootzoot.github.io/songbird/

## Public GitHub Repository

https://github.com/zootzootzoot/songbird

## 3-Minute Demo Video

(YouTube link)

## Describe your use of Meta products to build the submitted project

In the product, every release runs through these Meta models (credited on the record):

- Muse Spark 1.3 looks at the whole day in one call: the hero of each photo as a noun phrase SAM can find, what
  happened, and the order of the day. Later it directs the video: a shot list per line (close-up, duet, low angle,
  photo flash), with camera moves and effects.
- SAM 3.1 cuts each hero out of its photo from Spark's phrase, and tracks it through a phone clip into a moving
  sticker.
- Muse Wonder 1.0 is the producer: calls the genre, casts the band, writes the lyrics with every verse line tied to
  a photo, and the session notes. A mechanical checker sends it back until the song passes.
- Muse Image 1.0 paints a genre-authentic sleeve from that day's own cut-outs, and redraws each cut-out as its band
  role in the genre's wardrobe (keyed out with SAM's mask holding the body solid).
- Demucs (Meta FAIR, open weights) splits every take into singer and band; our tuner cuts any take where under 75%
  of the singing sits on the band's key.
- Muse Spark 1.2 (audio in) is the A&R: it listens to the takes that passed and keeps one, with a verdict.
- Muse Voice Transcribe hears the kept take's isolated vocal and finds which lyric lines were actually sung, and
  takes a spoken note from you ("i cried at the speech") into the song.
- MMS forced aligner (Meta FAIR, open weights) places every sung word on the vocal to the 20 ms frame, so the video's
  lyrics land on the beat.

The painters (sleeve, costumes, shot list) run while the band records, so four lamps are lit at once.

In the build, Meta models were our test bench (23 logged decisions in docs/META_LOG.md):

- Muse Spark 1.2 was our critic. It confirmed our first singing stack was "100% uncanny valley", and that verdict
  replaced the whole stack. It then auditioned the session band in 63 styles (124 clips); the 19 it believed are
  the repertoire, and its blind listening caught takes that didn't match their genre.
- Demucs proved a bug nobody could hear clearly: the singer was in F# minor over a band in F major (64% in key). The
  fix made every take 80-90% in key and recording 6x faster, and the measurement now ships as the tuner.
- Muse Voice Transcribe measured our first singer's intelligibility (72% of words) and later found the singer
  skipping half the song, which set the song-length rule (12-18 of 21 lines sung at 90 s, 19-20 at 120 s).
- MMS raised the share of lyric lines that start on a sung onset from 38-81% to 79-100% across the shelf.
- Muse Image photographed the nine sample days, redrew 20 of their objects for the front door, and painted its sky,
  so no real person's photos are used.

## Why are Meta's models important to your solution?

Because Songbird is only worth anything if it understands your day, and each part of that understanding is a
different Meta model handing off to the next.

Spark sees the whole day at once, so it can put the photos in the order the day happened and pick what matters in
each one. SAM cuts exactly that thing out from Spark's words, which turns your own objects into the
band instead of generic stock characters. Wonder makes the creative call and writes a song that is about your day
line by line. Muse Image makes those objects whole and in costume, and paints a sleeve from them rather than from a
text prompt. That chain is what makes the result yours.

The other half is that the label judges its own work. A song generator ships whatever it gets; Songbird records four
takes and lets Meta models decide. Demucs pulls the voice apart from the band so a key clash can be measured,
Spark 1.2 actually listens and keeps the best take, Voice Transcribe checks every line was sung, and MMS times every
word. Without those ears there would be off-key takes, missing verses and lyrics that drift off the music, which is
exactly what we shipped before we added them (all measured in docs/META_LOG.md).

Three of the models run on open weights on our own GPU (Demucs, MMS, and the ACE-Step band), so the expensive
audio work costs nothing per song. And because Meta covers vision, segmentation, writing, image, audio understanding
and speech, one platform carries the whole record, from photo to music video.

## Notes

- Problem statement: the form has a dropdown we haven't seen. Pick the one closest to creativity / personal media /
  consumer apps.
- Draft X post (for the Most Viral track; the owner posts it):

  > every day has a genre.
  >
  > i gave songbird five photos from a first half marathon. meta's models called it 1981 new wave of british heavy
  > metal, cast the running shoe on lead guitar, recorded four takes, cut the off-key ones and made the video.
  >
  > your days, on record → https://zootzootzoot.github.io/songbird/
  >
  > [the 9:16 MP4 attached]
