import { useCallback, useEffect, useRef, useState } from "react";
import { connect, getShelf, getTape, type Health } from "./lib/api";
import { sound } from "./lib/audio";
import { BASE, RENDER } from "./lib/env";
import { useDeck } from "./lib/useDeck";
import { keep } from "./lib/journal";
import { usePlayer } from "./lib/usePlayer";
import type { TapeSummary } from "./lib/types";
import { Front } from "./components/front/Front";
import { ControlRoom } from "./components/room/ControlRoom";
import { Dusk } from "./components/room/Dusk";
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

  // a new release of your own: into your journal (this device), and refresh the catalogue
  useEffect(() => {
    if (tape && state.source === "live") {
      keep(tape);
      void getShelf().then(setShelf);
    }
  }, [tape, state.source]);

  const openRelease = useCallback(
    async (id: string) => {
      const t = await getTape(id);
      if (t) deck.loadTape(t, "shelf");
    },
    [deck],
  );

  const surface = tape ? "video" : state.phase === "sending" || state.phase === "working" || state.phase === "error" ? "room" : "front";

  // pressing produce on the front door: dusk falls over the day while the room comes up
  const was = useRef(surface);
  const [dusk, setDusk] = useState(0);
  useEffect(() => {
    if (was.current === "front" && surface === "room" && !matchMedia("(prefers-reduced-motion: reduce)").matches) setDusk(Date.now());
    if (surface !== "room") setDusk(0);
    was.current = surface;
  }, [surface]);

  return (
    <div className="app" data-surface={surface}>
      {surface === "front" && (
        <Front deck={deck} shelf={shelf} health={health} online={isMock || online !== false} onOpen={openRelease} />
      )}
      {surface === "room" && <ControlRoom deck={deck} />}
      {surface === "room" && dusk > 0 && <Dusk key={dusk} name={state.name} onDone={() => setDusk(0)} />}
      {surface === "video" && tape && (
        <Video
          tape={tape}
          player={player}
          autoplay={state.source === "live" || state.source === "mock" || state.source === "replay" || RENDER}
          onExit={deck.eject}
          onReplay={!RENDER && (tape.takes?.length ?? 0) >= 2 ? () => deck.replay(tape) : undefined}
        />
      )}
    </div>
  );
}
