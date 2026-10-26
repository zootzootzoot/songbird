import { createFileRoute } from "@tanstack/react-router";
import { Deck } from "../components/songbird/Deck";
import { JCard } from "../components/songbird/JCard";
import { RisoFilters } from "../components/songbird/Halftone";
import { MACHINE_LINES } from "../lib/song";
import { useSongbird } from "../lib/useSongbird";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "songbird, a tape deck for small days" },
      {
        name: "description",
        content:
          "feed it six pictures from today. it prints a small song for bedtime and a j-card you can keep in a drawer.",
      },
      { name: "theme-color", content: "#4a2d1b" },
    ],
  }),
  component: Index,
});

function Index() {
  const deck = useSongbird();

  const status =
    deck.phase === "empty"
      ? "the deck is empty. feed it some pictures."
      : deck.phase === "loaded"
        ? `${deck.photos.length} pictures clipped in. pull the lever.`
        : deck.phase === "working"
          ? "the deck is making the song. the room is getting dark."
          : deck.phase === "done"
            ? "all done. the tape is warm."
            : deck.phase === "revealed"
              ? "the j-card is out. press play."
              : "playing.";

  return (
    <div
      className="room"
      data-phase={deck.phase}
      style={{ ["--progress" as string]: deck.progress }}
    >
      <RisoFilters />
      <span className="room__wall" aria-hidden="true" />
      <span className="room__lamp-pool" aria-hidden="true" />
      <span className="room__shade" aria-hidden="true" />
      <span className="room__warm" aria-hidden="true" />
      <span className="room__grain" aria-hidden="true" />

      <main className="scene">
        <header className="masthead">
          <span className="masthead__tape masthead__tape--left" aria-hidden="true" />
          <span className="masthead__tape masthead__tape--right" aria-hidden="true" />
          <h1 className="masthead__word">songbird</h1>
          <p className="masthead__line">a tape deck for small days</p>
          <span className="masthead__rule" aria-hidden="true" />
        </header>

        <div className="stage">
          <Deck deck={deck} />
          <JCard
            photos={deck.photos}
            name={deck.name}
            printed={deck.printed}
            activeLine={deck.activeLine}
            phase={deck.phase}
          />
        </div>

        <footer className="note">
          <p className="note__line">{MACHINE_LINES.footer}</p>
          <button
            type="button"
            className="note__sound"
            onClick={deck.toggleMuted}
            aria-pressed={deck.muted}
          >
            sound {deck.muted ? "off" : "on"}
          </button>
        </footer>
      </main>

      <p className="sr-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}