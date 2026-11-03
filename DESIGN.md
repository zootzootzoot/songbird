# Songbird: design

Songbird turns one day's photos into a produced single and its music video. An AI producer with enormous opinions
calls the genre, casts the things in your photos as the band (SAM cuts them out), writes the song, records four takes,
has a tuner throw out the off-key ones and an A&R ear pick the keeper, then cuts to the video.

The old toy-cassette / riso / family-keepsake look is retired and is an anti-reference. Nothing here should feel cute,
crafty or nostalgic-for-the-sake-of-it. The product is a record producer; it should feel like walking into a serious
studio at 3 a.m. where something slightly unhinged is being made with total conviction.

Two worlds, one product:

1. **The shell + control room** (front door, making-of, catalogue): one consistent, restrained, hardware-precise
   identity. This is where the brand lives.
2. **The video** (the result): full-screen, every genre gets its own art direction. The brand recedes to a small
   watermark and the transport.

## Name and voice

- The product is **Songbird**. Never "songbird records", never "a label for small days".
- Wordmark: `SONGBIRD` in Archivo, width 125, weight 900, tracking -0.02em, with a tally-red dot after it when live.
- Voice: the producer talks in lowercase, dry, confident, a little unhinged, never cute, never "magic", never emoji.
  UI labels are uppercase hardware engraving: `LOOK`, `CAST`, `PRODUCE`, `RECORD`, `TUNE`, `A&R`, `PRESS`.
- Release numbers stay (`SB-0012`). Models are named exactly as credits: Muse Spark 1.3, SAM 3.1, Muse Wonder 1.0,
  ACE-Step 1.5 XL, Demucs, Muse Spark 1.2, Muse Image 1.0, Muse Voice Transcribe.

## Shell tokens (control room)

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
