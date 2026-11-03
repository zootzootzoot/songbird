import { useCallback, useEffect, useState } from "react";
import { connect, getShelf, getTape, type Health } from "./lib/api";
import { sound } from "./lib/audio";
import { BASE } from "./lib/env";
import { useDeck } from "./lib/useDeck";
import { usePlayer } from "./lib/usePlayer";
import type { TapeSummary } from "./lib/types";
import { Front } from "./components/front/Front";
import { ControlRoom } from "./components/room/ControlRoom";
import { Video } from "./components/video/Video";

// the old deck's foley (paper, tape motor, bell) belongs to the retired cassette world
sound.setMuted(true);

/** `?tape=<id>` or `/t/<id>` */
function linkedTape(): string | null {
  const params = new URLSearchParams(location.search);
  const p = location.pathname;
  const path = (p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\//, "")).replace(/\/+$/, "");
  const m = path.match(/^t\/([^/]+)/);
  return params.get("tape") ?? (m ? decodeURIComponent(m[1]) : null);
}

export const isMock = import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

/**
 * Three surfaces, one state machine (useDeck):
 *   front door (empty / loaded)  ->  control room (sending / working / error)  ->  the video (done)
 */
export default function App() {
  const deck = useDeck();
  const { state } = deck;
  const tape = state.phase === "done" ? state.tape : null;
  const player = usePlayer(tape);
  const [shelf, setShelf] = useState<TapeSummary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    void connect().then((h) => {
      setHealth(h);
      setOnline(Boolean(h));
    });
    void getShelf().then(setShelf);
    const id = linkedTape();
    if (id) void deck.openById(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresh the catalogue when a new release lands
  useEffect(() => {
    if (tape && state.source === "live") void getShelf().then(setShelf);
  }, [tape, state.source]);

  const openRelease = useCallback(
    async (id: string) => {
      const t = await getTape(id);
      if (t) deck.loadTape(t, "shelf");
    },
    [deck],
  );

  const surface = tape ? "video" : state.phase === "sending" || state.phase === "working" || state.phase === "error" ? "room" : "front";

  return (
    <div className="app" data-surface={surface}>
      {surface === "front" && (
        <Front deck={deck} shelf={shelf} health={health} online={isMock || online !== false} onOpen={openRelease} />
      )}
      {surface === "room" && <ControlRoom deck={deck} />}
      {surface === "video" && tape && (
        <Video
          tape={tape}
          player={player}
          autoplay={state.source === "live" || state.source === "mock"}
          onExit={deck.eject}
        />
      )}
    </div>
  );
}
