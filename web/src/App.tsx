import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { connect, getShelf, getTape, type Health } from "./lib/api";
import { sound } from "./lib/audio";
import { formatTime } from "./lib/copy";
import { BASE } from "./lib/env";
import { LINE_PHOTO_IS_SONG_ORDER, useDeck } from "./lib/useDeck";
import { lastLineAt, lineAt, usePlayer } from "./lib/usePlayer";
import type { Tape, TapeSummary } from "./lib/types";
import { CHAIN, Device } from "./components/Device";
import { Day, type DayItem } from "./components/Day";
import { RisoFilters } from "./components/Halftone";
import { JCard } from "./components/JCard";
import type { ProducerMood } from "./components/Producer";
import { PrintView } from "./components/PrintView";
import { Receipt } from "./components/Receipt";
import { Shelf } from "./components/Shelf";
import { Subtitle } from "./components/Subtitle";

/** path after the site base, e.g. "t/abc" or "print/abc" */
function localPath() {
  const p = location.pathname;
  return (p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\//, "")).replace(/\/+$/, "");
}

function readView(): { print: string | null; tape: string | null } {
  const params = new URLSearchParams(location.search);
  const path = localPath();
  const pm = path.match(/^print\/([^/]+)/);
  const tm = path.match(/^t\/([^/]+)/);
  return {
    print: params.get("print") ?? (pm ? decodeURIComponent(pm[1]) : null),
    tape: params.get("tape") ?? (tm ? decodeURIComponent(tm[1]) : null),
  };
}

const isMock = import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

/**
 * While Muse Wonder produces (the longest wait), the producer deliberates out
 * loud. This is theatre, not model output: the real call lands when the
 * `genre` event arrives.
 */
const CONSIDERED: [string, string][] = [
  ["gregorian chant", "not enough handclaps."],
  ["sea shanty", "no boat."],
  ["1997 eurodance", "tempting. no."],
  ["polka", "absolutely not."],
  ["baroque, harpsichord only", "the harpsichord is busy."],
  ["elevator music", "the elevator declined."],
  ["free jazz", "too free."],
  ["power ballad", "save it for the bridge."],
  ["krautrock", "hmm. no."],
  ["barbershop quartet", "we only have one barber."],
  ["lo-fi beats to nap to", "nobody is napping."],
  ["death metal", "it's a sunday."],
];

export default function App() {
  const [view, setView] = useState(readView);
  const deck = useDeck();
  const { state } = deck;
  const tape = state.phase === "done" ? state.tape : null;
  const player = usePlayer(tape);
  const [shelf, setShelf] = useState<TapeSummary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingPlay = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const startedAt = useRef(0);
  const callAt = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    void connect().then((h) => {
      setHealth(h);
      setOnline(Boolean(h));
    });
    void getShelf().then(setShelf);
    const v = readView();
    if (v.tape && !v.print) void deck.openById(v.tape);
    const onPop = () => setView(readView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tape && pendingPlay.current) {
      pendingPlay.current = false;
      const id = window.setTimeout(() => void player.play(), 1200);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tape]);

  const { work, phase, photos } = state;
  const working = phase === "working" || phase === "sending";
  const canMake = isMock || online !== false;

  useEffect(() => {
    if (phase === "sending") startedAt.current = performance.now();
  }, [phase]);

  // the producer's call is a moment; it holds the room for a few seconds
  const genreSet = Boolean(work.genre);
  useEffect(() => {
    if (genreSet) callAt.current = performance.now();
  }, [genreSet]);

  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => setBeat((b) => b + 1), 1000);
    return () => window.clearInterval(id);
  }, [working]);

  const seenIdx = Object.keys(work.seen).map(Number).sort((a, b) => a - b);
  const looking = working && (!work.stage || work.stage === "looking") && seenIdx.length === 0;
  const deliberating = working && work.stage === "producing" && !work.genre;
  const calling = working && Boolean(work.genre) && performance.now() - callAt.current < 5200 && work.stage === "producing";
  const lookAt = looking && photos.length ? Math.floor(beat / 1.6) % photos.length : -1;
  const elapsed = working ? (performance.now() - startedAt.current) / 1000 : 0;
  const auditionIdx = deliberating && seenIdx.length ? seenIdx[Math.floor(beat / 3) % seenIdx.length] : null;

  const toUpload = useCallback(
    (p: number | null): number | null => {
      if (p === null) return null;
      if (LINE_PHOTO_IS_SONG_ORDER && work.order && work.order[p] !== undefined) return work.order[p];
      return p;
    },
    [work.order],
  );

  const active = tape ? lineAt(tape, player.time) : -1;
  const recent = tape ? lastLineAt(tape, player.time) : -1;
  const playingPhoto = tape && player.playing && recent >= 0 ? tape.lines[recent].photo : null;
  const bpm = tape?.bpm ?? work.genre?.bpm ?? 96;
  const beatSec = 60 / Math.max(50, Math.min(200, bpm));

  const items: DayItem[] = useMemo(() => {
    if (tape) {
      const roles = new Map((tape.band ?? []).map((b) => [b.photo, b.role]));
      return tape.photos.map((p, i) => ({
        key: `${tape.id}-${i}`,
        src: p.src,
        number: i + 1,
        label: `${p.hero}${roles.get(i) ? `, ${roles.get(i)}` : ""}`,
        state: {
          hero: p.hero,
          role: roles.get(i) ?? null,
          cutout: p.cutout,
          box: p.box,
          motion: p.motion ?? null,
          motionBox: p.motionBox ?? null,
          clip: p.clip ?? null,
          forward: player.playing && playingPhoto === i,
          dim: player.playing && playingPhoto !== null && playingPhoto !== i,
        },
      }));
    }
    return photos.map((p, i) => {
      const cut = work.cuts[i];
      return {
        key: p.key,
        src: p.src,
        video: Boolean(p.video),
        number: i + 1,
        label: work.seen[i] ? `picture ${i + 1}: ${work.seen[i].seen}` : `picture ${i + 1}`,
        state: {
          scanning: i === lookAt,
          hero: work.seen[i]?.hero ?? null,
          role: work.band[i] ?? null,
          cutting: working && !!work.seen[i] && !cut && work.stage === "cutting",
          box: cut?.box ?? null,
          cutout: cut?.cutout ?? null,
          motion: cut?.motion ?? null,
          motionBox: cut?.motionBox ?? null,
          clip: cut?.clip ?? null,
          fresh: true,
          forward: auditionIdx === i,
          dim: auditionIdx !== null && auditionIdx !== i,
          order: i,
        },
      };
    });
  }, [tape, photos, work, working, player.playing, playingPhoto, lookAt, auditionIdx]);

  const light = phase === "done" ? "night" : working ? (work.progress < 0.3 ? "dusk" : "evening") : "day";

  const mood: ProducerMood =
    phase === "error"
      ? "worried"
      : phase === "empty"
        ? "dozing"
        : player.playing
          ? "nodding"
          : phase === "done"
            ? "proud"
            : !working
              ? "looking"
              : calling
                ? "calling"
                : work.stage === "producing"
                  ? "thinking"
                  : work.stage === "recording"
                    ? "nodding"
                    : work.stage === "listening"
                      ? "listening"
                      : work.stage === "pressing"
                        ? "proud"
                        : "looking";

  // ---------------------------------------------------------------- copy
  const stageInfo = work.stage ? CHAIN[work.stage] : null;
  const takes = Object.entries(work.takes)
    .map(([i, t]) => ({ index: Number(i), ...t }))
    .sort((a, b) => a.index - b.index);
  const lastVerdict = [...takes].reverse().find((t) => t.verdict !== undefined);
  const takeNo = Math.min(2, takes.filter((t) => t.audio).length + (work.stage === "recording" ? 1 : 0));

  const display = (() => {
    if (online === false && !isMock && (phase === "empty" || phase === "loaded"))
      return { top: "studio", right: "closed", bottom: "the back catalogue plays" };
    switch (phase) {
      case "empty":
        return { top: "sb-6", right: "standby", bottom: "feed it the day" };
      case "loaded":
        return {
          top: "sb-6",
          right: `${photos.length} in`,
          bottom: photos.length >= deck.MIN ? "pull the lever" : "three, at least",
        };
      case "sending":
        return { top: "threading", right: formatTime(elapsed), bottom: "loading the tape" };
      case "working": {
        if (deliberating) {
          const [g] = CONSIDERED[Math.floor(beat / 2.6) % CONSIDERED.length];
          return { top: stageInfo?.model ?? "producing", right: formatTime(elapsed), bottom: `${g}? no.` };
        }
        if (work.stage === "recording")
          return { top: `take ${String(takeNo).padStart(2, "0")} · ace-step`, right: formatTime(elapsed), bottom: work.genre?.genre ?? work.label };
        return { top: stageInfo?.model ?? "working", right: formatTime(elapsed), bottom: work.label || "thinking" };
      }
      case "error":
        return { top: "snag", right: "", bottom: "see the session sheet" };
      case "done":
        return player.playing
          ? {
              top: tape?.catalog ?? "play",
              right: `${formatTime(player.time)} / ${formatTime(player.duration)}`,
              bottom: active >= 0 && tape ? tape.lines[active].text : tape?.title ?? "",
            }
          : { top: tape?.catalog ?? "side a", right: formatTime(player.duration), bottom: tape?.title ?? "" };
    }
  })();

  type Sub = Parameters<typeof Subtitle>[0];
  const subtitle: Sub = (() => {
    if (phase === "error") return { tone: "warn", kicker: "the session stopped", text: "the tape snagged.", sub: state.error?.message };
    if (phase === "done" && tape) {
      if (player.playing && active >= 0)
        return { tone: "song", line: tape.lines[active], kicker: (tape.lines[active].section || tape.title).toLowerCase() };
      return {
        tone: "song",
        kicker: [tape.catalog, tape.genre].filter(Boolean).join(" · "),
        text: tape.title,
        sub: player.playing ? tape.artist ?? tape.dedication : `${tape.artist ?? tape.dedication}. press play.`,
      };
    }
    if (working) {
      const act = stageInfo?.act ?? "the studio";
      if (calling && work.genre) return { tone: "call", kicker: "the producer's call", text: work.genre.genre, sub: work.genre.why };
      if (deliberating) {
        const [g, why] = CONSIDERED[Math.floor(beat / 2.6) % CONSIDERED.length];
        const who = auditionIdx !== null ? work.seen[auditionIdx]?.hero : null;
        return {
          tone: "consider",
          kicker: who ? `${act} · auditioning the ${who}` : act,
          text: `${g}?`,
          sub: why,
        };
      }
      if (work.stage === "producing" && work.title)
        return { tone: "work", kicker: "act iv · the lyric sheet", text: work.title, sub: work.genre?.genre };
      if (work.stage === "recording")
        return { tone: "work", kicker: act, text: takeNo <= 1 ? "take one. rolling." : "take two. from the top.", sub: work.genre ? `${work.genre.genre}, ${Math.round(work.genre.bpm)} bpm` : undefined };
      if (work.stage === "listening") {
        if (lastVerdict)
          return {
            tone: "verdict",
            kicker: `a&r on take ${lastVerdict.index + 1} · ${lastVerdict.score?.toFixed(1)}`,
            text: `“${lastVerdict.verdict}”`,
            stamp: { kept: Boolean(lastVerdict.kept) },
          };
        return { tone: "work", kicker: act, text: "listening back.", sub: "muse spark 1.2 is hearing both takes. nobody speak." };
      }
      if (work.stage === "pressing") return { tone: "work", kicker: act, text: "pressing the release.", sub: "muse image is painting the sleeve from the band." };
      if (work.stage === "cutting") {
        const cast = seenIdx.filter((i) => work.cuts[i]).map((i) => work.seen[i].hero);
        return { tone: "work", kicker: act, text: "casting the band.", sub: cast.length ? `so far: the ${cast.join(", the ")}.` : "sam 3.1 is cutting each one out." };
      }
      if (work.stage === "looking" && seenIdx.length)
        return { tone: "work", kicker: act, text: "it found the day.", sub: `the ${seenIdx.map((i) => work.seen[i].hero).join(", the ")}.` };
      return { tone: "work", kicker: act, text: work.label || "threading the tape." };
    }
    if (phase === "loaded")
      return photos.length >= deck.MIN
        ? {
            tone: "plain",
            kicker: "songbird records",
            text: "the band is waiting.",
            sub: canMake ? "pull the lever. about two minutes, start to finish." : "the studio is closed right now. the back catalogue still plays.",
          }
        : { tone: "plain", kicker: "songbird records", text: "a few more.", sub: "three at least, six at most. photos or short clips." };
    return {
      tone: "plain",
      kicker: "songbird records",
      text: "a record label for small days.",
      sub: canMake
        ? "give it today's photos. a very serious producer will make them a single."
        : "the recording studio is closed right now. the back catalogue still plays.",
    };
  })();

  // ------------------------------------------------------------- actions
  const onPick = useCallback(() => {
    sound.ensure();
    sound.click();
    fileInput.current?.click();
  }, []);

  const loadFromShelf = useCallback(
    async (id: string) => {
      sound.ensure();
      player.reset();
      sound.eject();
      setBusy(true);
      try {
        const t = await getTape(id);
        if (t) {
          pendingPlay.current = true;
          deck.loadTape(t, "shelf");
          window.setTimeout(() => sound.key(110), 420);
        }
      } catch {
        /* the sheet keeps its state */
      } finally {
        setBusy(false);
      }
    },
    [deck, player],
  );

  const goPrint = useCallback(
    (id: string) => {
      player.stop();
      const url = new URL(location.href);
      url.pathname = BASE;
      url.search = `?print=${encodeURIComponent(id)}`;
      history.pushState(null, "", url.toString());
      setView(readView());
      window.scrollTo(0, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player.stop],
  );

  const backFromPrint = useCallback(() => {
    const id = view.print;
    const url = new URL(location.href);
    url.pathname = BASE;
    url.search = id ? `?tape=${encodeURIComponent(id)}` : "";
    history.pushState(null, "", url.toString());
    setView(readView());
    if (id && state.tape?.id !== id) void deck.openById(id);
  }, [view.print, state.tape, deck]);

  if (view.print) return <PrintView id={view.print} initial={state.tape} onBack={backFromPrint} />;

  const leverReady = canMake && photos.length >= deck.MIN && (phase === "loaded" || phase === "error");

  return (
    <div
      className="app"
      data-light={light}
      data-phase={player.playing ? "playing" : phase}
      data-rec={working && work.stage === "recording"}
      data-call={calling}
      data-ready={ready}
      style={{ ["--progress" as string]: phase === "done" ? 1 : work.progress, ["--beat" as string]: `${beatSec}s` } as CSSProperties}
    >
      <RisoFilters />
      <div className="app__light" aria-hidden="true" />
      <div className="app__lamp" aria-hidden="true" />
      <div className="app__rec" aria-hidden="true" />
      <div className="app__grain" aria-hidden="true" />

      <header className="top">
        <a className="brand" href={BASE} aria-label="songbird records, home">
          <span className="brand__word">
            songbird <em>records</em>
          </span>
          <span className="brand__line">a record label for small days</span>
        </a>
        <Shelf tapes={shelf} current={tape?.id ?? null} busy={busy || working} onPick={loadFromShelf} />
        <button
          type="button"
          className="top__sound"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            sound.ensure();
            sound.setMuted(next);
          }}
          aria-pressed={!muted}
        >
          <span className="top__sound-dot" data-on={!muted} />
          studio sounds {muted ? "off" : "on"}
        </button>
      </header>

      <main className="stage">
        <Day
          items={items}
          phase={phase}
          count={tape ? tape.photos.length : photos.length}
          min={deck.MIN}
          canRemove={phase === "loaded" || phase === "error"}
          onRemove={deck.remove}
          onFiles={deck.addFiles}
          onPick={onPick}
          onSample={deck.addSample}
          note={state.note}
          setNote={deck.setNote}
          noteEditable={phase === "empty" || phase === "loaded" || phase === "error"}
          notice={state.notice}
          cast={Object.keys(work.band).length > 0 || Boolean(tape?.band?.length)}
        />

        <div className="stage__center">
          <Device
            phase={phase}
            stage={working ? work.stage : null}
            stageLive={working}
            doneStages={phase === "done"}
            display={display}
            name={state.name}
            setName={deck.setName}
            nameEditable={phase === "empty" || phase === "loaded" || phase === "error"}
            title={tape?.title ?? (working ? work.title : null)}
            spinning={working || player.playing}
            fast={working && work.stage !== "recording"}
            wound={phase === "done" ? player.time / Math.max(1, player.duration) : work.progress}
            generation={state.reel}
            level={levelAt(tape, player.time, player.playing, active, beatSec)}
            recording={working && work.stage === "recording"}
            take={takeNo}
            mood={mood}
            beat={beatSec}
            leverReady={leverReady}
            leverDown={working || phase === "done"}
            onPull={() => void deck.pull()}
            canPlay={Boolean(tape)}
            playing={player.playing}
            canStop={player.playing || player.time > 0}
            canEject={phase !== "empty"}
            onPlay={() => {
              sound.ensure();
              sound.key(150);
              if (!player.playing) void player.play();
            }}
            onStop={() => {
              sound.key(180);
              if (player.playing) player.stop();
              else player.reset();
            }}
            onEject={() => {
              sound.ensure();
              sound.key(120);
              sound.eject();
              player.reset();
              deck.eject();
            }}
          />
          <Subtitle {...subtitle} time={player.time} />
        </div>

        <div className="output">
          {tape ? (
            <JCard
              key={`${tape.id}-${state.reel}`}
              tape={tape}
              activeLine={player.playing || player.time > 0 ? active : -1}
              onSeek={(t) => {
                sound.ensure();
                player.seek(t);
                if (!player.playing) void player.play();
              }}
              onPrint={() => goPrint(tape.id)}
            />
          ) : (
            <Receipt
              phase={phase}
              work={work}
              thumb={(i) => {
                const c = work.cuts[i];
                if (c?.motion) return { src: c.motion, sticker: true };
                if (c?.cutout) return { src: c.cutout, sticker: true };
                const p = photos[i];
                return p && !p.video ? { src: p.src, sticker: false } : undefined;
              }}
              photoForLine={toUpload}
              health={health}
              error={state.error}
              canRetry={canMake && (state.uploaded.length || photos.length) >= deck.MIN}
              onRetry={() => void deck.pull()}
              onShelf={() => shelf[0] && loadFromShelf(shelf[shelf.length - 1].id)}
            />
          )}
          {tape && player.silent && player.playing && (
            <p className="output__silent">this pressing has no audio on it yet. the deck is keeping time.</p>
          )}
        </div>
      </main>

      <footer className="foot">
        <span>songbird records. every day gets a release.</span>
        <span>looked at by muse spark · cast by sam 3.1 · produced by muse wonder · played by ace-step · a&r by muse spark 1.2 · sleeve by muse image</span>
      </footer>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="image/*,video/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          if (e.target.files?.length) deck.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function levelAt(tape: Tape | null, t: number, playing: boolean, active: number, beat: number) {
  if (!tape || !playing) return 0;
  const pulse = 0.5 + 0.5 * Math.cos(((t % beat) / beat) * Math.PI * 2);
  const singing = active >= 0 && tape.lines[active].words.some((x) => t >= x.start && t < x.end);
  return Math.min(1, (singing ? 0.55 : 0.35) + pulse * 0.35);
}
