# Songbird: design

Songbird turns one day's photos into a produced single and its music video. An AI producer with enormous opinions
calls the genre, casts the things in your photos as the band (SAM cuts them out), writes the song, records four takes,
has a tuner throw out the off-key ones and an A&R ear pick the keeper, then cuts to the video.

The old toy-cassette / riso / family-keepsake look is retired and is an anti-reference. Nothing here should feel cute,
crafty or nostalgic-for-the-sake-of-it. The product is a record producer; it should feel like walking into a serious
studio at 3 a.m. where something slightly unhinged is being made with total conviction.

Identity: **a music journal, every day you live becomes a single** (PRODUCT.md). Three worlds, in the order a day
goes through them:

1. **The front door is daylight.** The day happens out here. A real sky (painted by Muse Image) with the things from
   people's days floating in it, each a glossy object Muse Image redrew from a sample photo. Hover one and a pill names
   it and whose day it came from; click it and its single plays. Below: the shelf, the manifesto, how it works, the desk.
2. **The control room is the studio at night**, where the day gets made: restrained, hardware-precise, dark.
3. **The video is the record**: full-screen, every genre gets its own art direction. The brand recedes to a small
   watermark and the transport.

## Front door

References: corner.inc (a world of floating objects in a sky, a lowercase manifesto voice, a black "about" band) and
sanctum.so (calm white space, soft rounded cards, small white proof pills with a status dot). Neither is copied.

- Palette: sky photo; white `#fff`; paper `#f6f5f1`; card `#f3f2ee`; ink `#0c1424`; ink-2 `#3b414d`; mute `#6c717b`;
  live dot `#1fbf5b`. One black band (`#0b0b0d`) for "why songs".
- Type: Archivo only (Martian Mono for catalogue numbers). Wordmark huge, lowercase, wdth 112, weight 800, -0.06em.
  Section heads lowercase with a full stop ("this week on songbird."), weight 750, -0.04em.
- Shapes: pills (999px) for every action and proof; cards 26px outer / 20px media radius; no hairline panels here.
- Proof pills quote the tape, never a made-up number: "in key 91%", "4 takes, 3 off key, 1 kept", "every line sung".
- Motion: objects bob slowly (7–14 s), drift with pointer parallax by depth, the sky drifts over 60 s; text rises in
  once. Reduced motion stops all of it.
- Sections: hero (wordmark, "every day has a genre.", black pill CTA, a live "maya's day was 1930s tango" pill) ·
  your discography (only when you have made some here: a row of your own sleeves with their dates) · the shelf (3-up cards: sleeve, whose day, their note, the genre, title, proof, the photo roll) · why songs
  (manifesto with two cited facts) · how a day becomes a single (one real release: photo → cut-out → band member →
  sleeve, then the model chain) · the desk (photos, whose day, the note, produce) · footer (sample-day disclosure).

## Name and voice

- The product is **Songbird**. Never "songbird records", never "a label for small days".
- Wordmark: `songbird`, lowercase, Archivo width 112, weight 800, tracking -0.045em, on every surface.
- Voice: lowercase, warm, dry, sure of itself; the producer is a little unhinged. Never cute, never "magic", never emoji.
  UI labels are uppercase hardware engraving: `LOOK`, `CAST`, `PRODUCE`, `RECORD`, `TUNE`, `A&R`, `PRESS`.
- Release numbers stay (`SB-0012`). Models are named exactly as credits: Muse Spark 1.3, SAM 3.1, Muse Wonder 1.0,
  ACE-Step 1.5 XL, Demucs, Muse Spark 1.2, Muse Image 1.0, Muse Voice Transcribe.

## Control room tokens

| token | value | use |
|---|---|---|
| `--room` | `#0b0a09` | page: warm black, never pure #000 |
| `--console` | `#14120f` | panels |
| `--console-hi` | `#1c1915` | raised controls, hover |
| `--hair` | `#2a2620` | 1px rules, panel edges |
| `--bone` | `#ece6da` | primary text |
| `--dim` | `#8a8274` | secondary text, idle labels |
| `--faint` | `#4d473e` | disabled, grid marks |
| `--tally` | `#ff3d1f` | REC, live, kept, the one loud colour |
| `--vu` | `#ffb21e` | meters, active lamps, the producer's talkback |
| `--cue` | `#62e28a` | pass / in key, sparingly |

Type (Google Fonts):
- **Archivo** (variable `wdth` 62..125, `wght` 100..900). Display = wdth 125 / wght 800-900. UI labels =
  wdth 75 / wght 600, uppercase, letter-spacing 0.08em, 11-12px. Body = wdth 100 / wght 400.
- **Martian Mono** (variable `wdth` 75..112, `wght` 100..800) for every number: timecode, BPM, key, percentages,
  scores, release numbers.
- No serif in the shell. No script. No rounded fonts.

Layout: designed for 1920x1080 first (the demo is a screen recording), fits one viewport with no page scroll from
1280x720 up, collapses to a single column on phones. 24px gutters, 1px hairline panels, 4px radius max (hardware,
not cards). Density is a virtue: this is a console, it should look like it has a lot going on and all of it is real.

Motion in the shell is mechanical: lamps fade in 120 ms, meters have ballistics (fast attack, slow release), text
arrives like a teletype, panels slide on a fixed easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. No bounce, no confetti.
Respect `prefers-reduced-motion`.

## The control room (making view)

Driven entirely by real pipeline events (see docs/CONTRACT.md). Every model is a lamp on the top strip and lights
when it is actually working. Regions:

- **Top strip**: wordmark, session/release number, REC tally + running timecode, the model lamps.
- **Channels** (left): one channel strip per photo. The photo, then SAM's cutout lifting off it when `cut` arrives,
  the hero noun phrase as the channel name, and later the band role as a scribbled credit.
- **Talkback** (centre, the star): the producer's head. The genre call lands in huge expanded type ("1964 KINGSTON
  FIRST-WAVE SKA"), the why underneath, then the lyric sheet types out line by line, each line lighting its
  channel. Stage labels stream like a console log.
- **Takes** (right): four take lanes. Each shows a waveform/reel when the take arrives, the tuner reading (Demucs
  split: vocal and band as two lanes pulling apart, `in key 81%`, `cut` in tally red if under 75%), then Spark's
  verdict as a quoted talkback line, then KEPT.
- **Transport** (bottom): the seven stages as a timeline with the playhead on the current one.

When `done` arrives: the room holds for a beat on KEPT, then hard-cuts to the video.

## The video (result view)

Full-screen, plays with the song. Built from the tape: SAM cutouts (and moving stickers), the original photos, the
cover, word-timed lyrics, bpm, band credits, genre/style. Structure, in every theme:

1. **Title card** until the first sung line: release number, title, artist, genre, cover.
2. **The band on stage**: every cutout on screen, the current line's photo cutout is the frontman (large,
   lit); the rest perform smaller, moving on the beat (60/bpm). Moving stickers play where present.
3. **Photo flashes**: on a line tied to a photo, that photo goes full-bleed behind the band, treated in the theme.
4. **Kinetic lyrics**, word-timed; chorus lines bigger. Theme decides the type and motion.
5. **Lower thirds** introduce each band member the first time they front a line ("THE YELLOW BOOTS — kick drum,
   puddle department").
6. **Credits roll** at the end: the band, then the models.

Minimal overlay transport (play/pause, scrub, time, fullscreen, back to the studio, share) that hides while playing.

### Genre themes

The tape's `style` (one of the 19 the band plays) picks the theme. Each theme is a palette, a display face, a
background, a lyric treatment and a band motion. Families:

| theme | styles | look |
|---|---|---|
| neon | synthwave, italo disco, synth-pop, eurodance | night purple to magenta, perspective grid + sun, chrome gradient type, glow, scanlines |
| strut | funk, soul | 1970s brown/orange/mustard stripes, fat italic display, cutouts on a soul-train riser |
| deco | big band | black and gold, sunburst rays, art-deco display, spotlights |
| two-tone | ska | black/white checkerboard, red, stencil display, band skanks on the offbeat |
| arena | hard rock, power ballad | smoke, lens flares, chrome display; power ballad is softer haze, wind-machine float |
| zine | punk, indie rock | photocopy grain, ransom-note lyrics, highlighter pink/yellow, tape |
| atomic | rock and roll, rockabilly, surf rock | cream/teal/cherry, starbursts, script display; surf adds waves |
| blue note | bossa nova | Reid Miles: duotone photos, giant stacked sans, big negative space |
| milonga | tango, salsa | tango: oxblood and black, high-contrast Bodoni italic; salsa: Fania-bright blocks |
| 8-bit | chiptune | pixel font, pixelated cutouts, CRT |

## Bans

- No cassette, J-card, riso, kraft paper, doodles, washi tape (except as genre treatment in "zine"), toy shapes.
- No generic SaaS: no gradient-purple hero, no glassmorphism cards, no centered-hero-with-three-feature-cards.
- No emoji in UI. No "AI-powered", no "magic".
