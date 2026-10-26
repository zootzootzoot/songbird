# Songbird

A toy cassette deck that lives on a nightstand. Feed it six pictures from a day, pull the lever, and it works: the light in the room moves from late afternoon to a single warm lamp, the tape runs, the bird wakes up, and a printed J-card slides out with the title, the photographs and the lyrics in handwriting. Then you press play.

Everything on screen is built to look printed rather than rendered: four riso inks (vermilion, sunflower, deep ocean, cocoa) on warm grainy paper, halftone photographs, misregistration, Dymo-tape labels and a fat 1970s serif.

## What is in here

- `app/src/components/songbird/` the deck, one part per file: perch and bird, photo strip, cassette, gauges, lamp, lever, keys, printer slot, tray, J-card, halftone print treatment.
- `app/src/lib/song.ts` the lyrics, the sample roll and every line of machine copy.
- `app/src/lib/audio.ts` the foley: paper, plastic, tape motor, brass bell, room tone, and a placeholder lullaby.
- `app/src/lib/useSongbird.ts` the state machine: empty, photos in, working, retake, done, reveal, playing.
- `app/src/styles.css` the print system: inks, paper, wood, plastic, the J-card.
- `app/design-brief.md` the design contract the build follows.

## Notes

- Placeholder content lives in `song.ts` and `audio.ts`: six sample photographs, seven lyric lines, and a synthesised melody. Swap those two files to connect a real song and a real voice.
- Audio is created on the first tap, never before.
- The photo tray accepts real files by drop or picker and prints them through the same halftone filter.
- Tap the lamp while the deck is working to hurry it along.

## Build

The deployed site is a React 19 + TanStack Start app on Cloudflare Workers, built by the Higgsfield platform. This repository holds the product source: the deck components, the print system and the flow. The platform harness (vendored package snapshots, agent files and deployment config) is intentionally not included, so `app/` is not a standalone install.

## Launch imagery

Cover and icon were composed from a generated riso scene; the URLs live in `app/src/app-meta.json`.