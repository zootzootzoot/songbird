# Songbird — design brief

## Design read
A keepsake machine for a parent and a small child at the end of a long day: quiet,
tactile, a little funny, printed rather than rendered.

## Concept spine
**The site is a machine you own.** Not a page about a toy: one toy cassette deck
sitting on a nightstand, at arm's length. Every progress cue is physical (a lever,
reels, a lamp, room light). The room's light is the progress bar.

## Delivery tier
`editorial`, single fixed scene: one screen, no scroll journey (user chose "one
screen, all tactile" at intake). The craft floor is met with bespoke physical
micro-motion: masses, clacks, bounces, settling, a real change of light.

Animation mode: non-animated — user picked "One screen, all tactile (recommended)" at intake.

## Locked palette
- Vermilion `#e0472a` (lever, breast, highlighter, retake flag)
- Sunflower `#efb02f` (deck plastic, lamp, paper warmth)
- Deep ocean `#1d4a68` (cassette acetate, wing, dusk shade, small print)
- Cocoa `#3d2a1c` (line work, type, screws, wood grain)
- Paper `#f3e7ce`, second sheet `#e8d9ba`
- Overprint (inks multiplied): `#7a3324` and `#233c33`
Defense: these are the user's named riso inks. The warm paper is a substrate, not
the brand: the object itself is saturated sunflower plastic with a vermilion lever
on dark walnut, so it never reads as the beige + brass premium web default.

## Locked type
- Display: **Alfa Slab One** — fat, soft, slightly eccentric slab serif; 1970s
  children's packaging. Used for the wordmark, J-card title, tape label.
- Labels: **Archivo Black**, uppercase, 8-10px, letter-spaced, embossed as raised
  Dymo-style tape strips (light top edge, dark bottom edge, plastic shadow).
- Hand: **Caveat**, uneven baselines, tiny per-line rotations, used on the cassette
  label and the J-card lyrics.
- Print body: **Hanken Grotesk** at 12-13px, cocoa on paper.

## Type scale
wordmark 34/desktop 46 · J-card title 30/38 · tape label 20 · lyric 20 · dymo 9 ·
small print 11.5

## Section plan
1. Masthead plaque (taped paper card, wordmark + one line) — object label family.
2. The nightstand scene: deck stack (perch, strip, cassette, controls, keys, tray,
   slot). One long vertical instrument, asymmetric part rhythm, no repeating cards.
2b. Print strip slot: a receipt printer body that feeds handwritten lines.
3. J-card panel: printed keepsake, laid on the wood, right of the deck on desktop,
   below on mobile.
4. Footer note: a small printed receipt with one dry line.

## Asset plan
- Six placeholder day photos, printed as three-stop two-ink halftones (SVG
  component-transfer duotone + dot screen + misregistration).
- Bird drawn as a flat geometric SVG in code (Charley Harper / wooden toy), the only
  expressive face on screen.
- Paper, wood, plastic, acetate, tape, screws, chips: CSS only, no photographic
  texture downloads.
- Deck nameplate, gauges, keys, clips, J-card: HTML/CSS, so the object stays crisp
  and interactive.
- Launch cover, OG image, favicon: generated.

## CTA inventory (each its own interaction identity)
- **Tray slot** — dashed print border, paper lip; opens the photo picker; sample roll
  as an embossed tape tab.
- **Lever** — 60px vermilion paddle, drag or tap, rotates with weight, thunks home.
- **Keys** — three physical plastic keys (play, stop, eject), each with its own
  travel and click pitch; depressed while held.
- **Label** — a writable paper label: an input that types in ink.
- **Lamp** — a round amber button that also hurries the machine along.
- **J-card** — no button; it arrives. Play is the only way forward.

## Copy rules
Lowercase, short, dry, warm. No "AI", "magic", "generate", "powered by", no
sparkles, no em-dashes.
