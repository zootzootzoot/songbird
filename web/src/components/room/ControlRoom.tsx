import { useRef } from "react";
import type { Deck } from "../../lib/useDeck";
import type { Stage } from "../../lib/types";
import { Channels, type ChannelView } from "./Channels";
import { Talkback, type Call, type LogLine, type SheetLine } from "./Talkback";
import { Takes, type LaneView } from "./Takes";
import { TopStrip, type Lamp } from "./TopStrip";
import { Transport } from "./Transport";
import { IN_KEY, STEPS, TAKE_COUNT, clock, derive, pad2, roomNow, roomSpeed, useNow, useReducedMotion, useStamps, type StepId } from "./model";

/**
 * The making view. See DESIGN.md "The control room".
 *
 * Driven entirely by the deck's real event stream. The only things the room
 * adds are timing: when each event reached the room, and the teletype pace at
 * which a burst of events (the lyric sheet, the verdicts) is read out.
 */
export function ControlRoom({ deck }: { deck: Deck }) {
  // a retry from the error screen is a fresh session: new clocks, new stamps
  const run = useRef({ n: 0, phase: deck.state.phase });
  if (deck.state.phase === "sending" && run.current.phase === "error") run.current.n += 1;
  run.current.phase = deck.state.phase;
  return <Room key={run.current.n} deck={deck} />;
}

/** teletype pace */
const LINE_MS_PER_CHAR = 15;
const LINE_GAP = 70;
const WHY_MS_PER_CHAR = 13;
const SEEN_MS_PER_CHAR = 16;
const AUDITION_SLOT = 4200;
const VERDICT_STAGGER = 320;
const DEMUCS_LAMP = 1800;

const STAGE_WHO: Record<Stage, string> = {
  looking: "Muse Spark 1.3",
  cutting: "SAM 3.1",
  producing: "Muse Wonder 1.0",
  recording: "ACE-Step 1.5 XL",
  listening: "Muse Spark 1.2",
  pressing: "Muse Image 1.0",
};

function Room({ deck }: { deck: Deck }) {
  const { state } = deck;
  const w = state.work;
  const f = derive(state);
  const reduced = useReducedMotion();
  const st = useStamps();
  const halted = state.phase === "error";
  const working = state.phase === "working" || state.phase === "sending";
  useNow(30, !halted); // re-render at 30 fps; read the clock fresh so stamps made this render are never in the future
  const born = st.mark("born");
  const wall = useRef(new Date());

  // ---- stamps: when each thing reached the room
  for (const e of w.log) st.mark(e.key);
  if (w.stage) st.mark(`stage:${w.stage}`);
  for (const s of STEPS) {
    const step = f.steps[s.id];
    if (step.state !== "idle") st.mark(`s:${s.id}`);
    if (step.state === "done") st.mark(`e:${s.id}`);
  }
  const now = halted ? st.mark("halt") : roomNow();
  const since = (t: number | null) => (t === null ? 0 : now - t);

  // ---- the call: genre + why
  const genreAt = st.get("genre");
  const why = w.genre?.why ?? "";
  const whyStart = genreAt === null ? 0 : genreAt + 700;
  const whyTyped = reduced ? why.length : Math.max(0, Math.min(why.length, Math.floor((now - whyStart) / WHY_MS_PER_CHAR)));
  const sheetStart = whyStart + Math.min(1600, why.length * WHY_MS_PER_CHAR * 0.5);

  // ---- the lyric sheet, read out line by line
  const lineIdx = Object.keys(w.lines)
    .map(Number)
    .sort((a, b) => a - b);
  let cursor = sheetStart;
  let typingPhoto: number | null = null;
  const sheet: SheetLine[] = lineIdx.map((i, n) => {
    const l = w.lines[i];
    const arrived = st.get(`line-${i}`) ?? now;
    const start = Math.max(arrived, cursor + (n ? LINE_GAP : 0));
    const dur = Math.max(260, Math.min(1000, l.text.length * LINE_MS_PER_CHAR));
    cursor = start + dur;
    const p = reduced ? 1 : (now - start) / dur;
    const state: SheetLine["state"] = p >= 1 ? "done" : p > 0 ? "typing" : "wait";
    if ((state === "typing" || (p >= 1 && now - (start + dur) < 220)) && l.photo !== null) typingPhoto = l.photo;
    const prev = n > 0 ? w.lines[lineIdx[n - 1]] : null;
    return {
      index: i,
      text: l.text,
      photo: l.photo,
      section: l.section,
      typed: Math.floor(Math.max(0, Math.min(1, p)) * l.text.length),
      state,
      head: !prev || prev.section !== l.section,
    };
  });

  // ---- the producing wait: the producer works through the cast, channel by channel
  const seenIdx = Object.keys(w.seen)
    .map(Number)
    .sort((a, b) => a - b);
  const produceAt = st.get("s:produce");
  let call: Call;
  let auditionK: number | null = null;
  if (state.phase === "sending" || (!w.stage && !seenIdx.length)) {
    call = { mode: "sending", files: state.photos.length, name: state.name.trim(), note: state.note.trim() };
  } else if (w.genre) {
    call = { mode: "call", genre: w.genre.genre, why, whyTyped, bpm: w.genre.bpm, musicKey: w.genre.key, title: w.title, cover: w.cover };
  } else if (seenIdx.length && produceAt !== null && f.stageIdx >= 1) {
    const elapsed = Math.max(0, now - produceAt);
    const slot = Math.floor(elapsed / AUDITION_SLOT);
    const k = seenIdx[slot % seenIdx.length];
    auditionK = k;
    const seen = w.seen[k] ?? { hero: "", seen: "" };
    const typed = reduced ? seen.seen.length : Math.floor((elapsed - slot * AUDITION_SLOT - 250) / SEEN_MS_PER_CHAR);
    call = {
      mode: "audition",
      k,
      of: Math.max(f.photoN, seenIdx.length),
      hero: seen.hero,
      seen: seen.seen,
      typed: Math.max(0, Math.min(seen.seen.length, typed)),
      clock: clock(elapsed),
      notes: w.log
        .filter((e) => e.kind === "stage" && e.stage === "producing")
        .map((e) => (e.kind === "stage" ? e.label : ""))
        .slice(-3),
    };
  } else {
    call = { mode: "looking", files: f.photoN, name: state.name.trim(), note: state.note.trim() };
  }

  // ---- channels
  const nCh = Math.max(state.photos.length, seenIdx.length ? Math.max(...seenIdx) + 1 : 0);
  const linesPer: Record<number, number> = {};
  for (const i of lineIdx) {
    const p = w.lines[i].photo;
    if (p !== null) linesPer[p] = (linesPer[p] ?? 0) + 1;
  }
  const focusK = typingPhoto ?? auditionK;
  const channels: ChannelView[] = Array.from({ length: nCh }, (_, k) => {
    const cutAt = st.get(`cut-${k}`);
    const bandAt = st.get(`band-${k}`);
    const seenAt = st.get(`seen-${k}`);
    const recent = [cutAt, bandAt, seenAt].some((t) => t !== null && now - t < 700);
    const p = state.photos[k];
    let level = 0;
    if (halted) level = 0;
    else if (k === typingPhoto) level = 1;
    else if (k === auditionK) level = 0.8;
    else if (recent) level = 0.6;
    else if (w.cuts[k]?.cutout || w.cuts[k]?.motion) level = 0.1;
    return {
      k,
      src: p?.src ?? null,
      video: Boolean(p?.video),
      hero: w.seen[k]?.hero ?? null,
      seen: w.seen[k]?.seen ?? null,
      cut: w.cuts[k] ?? null,
      performer: w.performers[k] ?? null,
      role: w.band[k] ?? null,
      lines: linesPer[k] ?? 0,
      level,
      focus: k === focusK && !halted,
    };
  });

  // ---- takes
  const recordAt = st.get("s:record");
  const verdictAt = st.get("verdict-0") ?? st.get("verdict-1") ?? st.get("verdict-2") ?? st.get("verdict-3");
  const scoredOrder = f.takes.filter((t) => t.scored).map((t) => t.index);
  const lanes: LaneView[] = f.takes.map((t) => {
    let recClock: string | null = null;
    if (t.status === "rec") {
      const prev = t.index > 0 ? st.get(`take-${t.index - 1}`) : null;
      recClock = clock(since(prev ?? recordAt ?? now));
    }
    const order = scoredOrder.indexOf(t.index);
    const readAt = verdictAt === null ? null : verdictAt + (order < 0 ? 0 : order) * VERDICT_STAGGER;
    const readOut = reduced ? t.verdict !== undefined : readAt !== null && now >= readAt;
    const stampAt = verdictAt === null ? null : verdictAt + scoredOrder.length * VERDICT_STAGGER + 260;
    return {
      ...t,
      recClock,
      readOut,
      stamped: Boolean(t.kept) && (reduced || (stampAt !== null && now >= stampAt)),
    };
  });

  // ---- lamps: lit only while that model is working
  const lastTakeAt = Math.max(...Array.from({ length: TAKE_COUNT }, (_, i) => st.get(`take-${i}`) ?? -Infinity));
  const tunedN = f.takes.filter((t) => t.arrived && t.inKey !== undefined).length;
  // the painters (sleeve, costumes, shot list) start the moment the song is written and work while the band records
  const painting = working && w.genre !== null && state.phase !== "error";
  const perfN = Object.keys(w.performers).length;
  const castN = Math.max(f.photoN, 1); // every picture gets dressed, not only the ones with a band role
  const kept = f.takes.find((t) => t.kept);
  const listening = w.stage === "listening";
  const lamps: Lamp[] = [
    { name: "Muse Spark 1.3", role: "LOOK", on: working && f.steps.look.state === "active", read: `${f.seenN}/${f.photoN || "-"}` },
    { name: "SAM 3.1", role: "CUT", on: working && f.steps.cast.state === "active", read: `${f.cutN}/${f.seenN || "-"}` },
    {
      name: "Muse Wonder 1.0",
      role: "PRODUCE",
      on: working && w.stage === "producing" && !w.genre,
      read: w.genre ? `${f.lineN} LN` : w.stage === "producing" ? "WRITING" : "--",
    },
    {
      name: "Muse Image 1.0 + SAM",
      role: "DRESS",
      on: painting && perfN < castN && w.stage !== "pressing",
      read: w.genre ? `${perfN}/${castN}` : "--",
    },
    { name: "Muse Image 1.0", role: "SLEEVE", on: painting && !w.cover && w.stage !== "pressing", read: w.cover ? "PAINTED" : w.genre ? "PAINTING" : "--" },
    { name: "Muse Spark 1.3", role: "DIRECT", on: painting && w.shots === null && w.stage !== "pressing", read: w.shots !== null ? `${w.shots} SHOTS` : "--" },
    { name: "ACE-Step 1.5 XL", role: "RECORD", on: working && f.steps.record.state === "active", read: `${f.takesIn}/${TAKE_COUNT}` },
    { name: "Demucs", role: "TUNE", on: working && now - lastTakeAt < DEMUCS_LAMP, read: `${tunedN}/${TAKE_COUNT}` },
    {
      name: "Muse Spark 1.2",
      role: "A&R",
      on: working && listening && f.verdictN === 0,
      read: `${f.takes.filter((t) => t.scored).length}/${f.takes.filter((t) => t.arrived && !t.cut).length || "-"}`,
    },
    {
      name: "Muse Voice Transcribe",
      role: "CHECK",
      on: working && listening && f.verdictN === 0,
      read: typeof kept?.sung === "number" ? `${Math.round(kept.sung * 100)}% SUNG` : "--",
    },
    {
      name: "MMS aligner",
      role: "TIME",
      on: working && listening && f.verdictN > 0 && !w.timed,
      read: w.timed ? `${w.timed.words} WDS` : "--",
    },
  ];

  // ---- transport clocks
  const clocks = {} as Record<StepId, string>;
  for (const s of STEPS) {
    const a = st.get(`s:${s.id}`);
    const b = st.get(`e:${s.id}`);
    clocks[s.id] = a === null ? "--:--.-" : clock((b ?? now) - a);
  }

  // ---- console log
  const log = consoleLines(w, (key) => st.get(key), born);

  const elapsed = now - born;
  const fr = Math.floor((elapsed % 1000) / (1000 / 30));
  const secs = Math.floor(elapsed / 1000);
  const timecode = `${pad2(Math.floor(secs / 3600))}:${pad2(Math.floor(secs / 60) % 60)}:${pad2(secs % 60)}:${pad2(fr)}`;
  const stageAt = w.stage ? st.get(`stage:${w.stage}`) : null;
  const replayOf = state.source === "replay" ? state.replay : null;
  const session = replayOf
    ? replayOf.catalog
    : w.id ?? (state.source === "mock" ? "MOCK REPLAY" : state.phase === "sending" ? "UPLOADING" : "----");
  const madeAt = replayOf ? new Date(replayOf.at) : null;

  const halt = halted ? (
    <div className="rm-halt" role="alert">
      <div className="rm-halt__kick label">
        <i />
        Session halted
        {f.fault && (
          <>
            <span className="rm-call__sep">/</span> {STEPS.find((s) => s.id === f.fault)?.label}
          </>
        )}
      </div>
      <p className="rm-halt__msg">{state.error?.message ?? "the tape stopped."}</p>
      <p className="rm-halt__sub">
        everything the room heard so far is still on the desk. run it again from the top, or take the day back to the door.
      </p>
      <div className="rm-halt__actions">
        {state.uploaded.length >= deck.MIN && (
          <button type="button" className="rm-btn rm-btn--go" onClick={() => void deck.pull()}>
            <span className="label">Run it again</span>
          </button>
        )}
        <button type="button" className="rm-btn" onClick={deck.eject}>
          <span className="label">Back to the door</span>
        </button>
      </div>
    </div>
  ) : null;

  return (
    <main className="room" data-phase={state.phase} data-stage={w.stage ?? "none"}>
      <TopStrip
        live={working}
        halted={halted}
        session={session}
        day={state.name.trim() ? `${state.name.trim().toLowerCase()}'s` : "today"}
        started={(() => {
          const d = madeAt && !Number.isNaN(madeAt.getTime()) ? madeAt : wall.current;
          return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
        })()}
        replay={replayOf ? `REPLAY ${roomSpeed()}×` : undefined}
        timecode={timecode}
        progress={w.progress}
        lamps={lamps}
        onStop={deck.eject}
      />
      <div className="rm-desk">
        <Channels channels={channels} looking={working && (state.phase === "sending" || f.stageIdx <= 0)} cutN={f.cutN} seenN={f.seenN} />
        <Talkback
          who={halted ? "the room" : w.stage ? STAGE_WHO[w.stage] : "uplink"}
          label={halted ? "stopped" : w.label || (state.phase === "sending" ? "threading the session" : "")}
          stageClock={stageAt === null ? "--:--.-" : clock(now - stageAt)}
          call={call}
          sheet={sheet}
          lineN={lineIdx.length}
          log={log}
          halted={halt}
          reduced={reduced}
        />
        <Takes lanes={lanes} />
      </div>
      <Transport steps={f.steps} clocks={clocks} elapsed={clock(elapsed, false)} />
    </main>
  );
}

function consoleLines(w: Deck["state"]["work"], stampOf: (key: string) => number | null, born: number): LogLine[] {
  const seen = w.seen;
  const out: LogLine[] = [];
  let lines = 0;
  for (const e of w.log) {
    const at = stampOf(e.key);
    const t = `+${clock(at === null ? 0 : at - born)}`;
    switch (e.kind) {
      case "stage":
        out.push({ key: e.key, t, src: e.stage.toUpperCase(), text: e.label, tone: "vu" });
        break;
      case "seen":
        out.push({ key: e.key, t, src: "SPARK 1.3", text: `ch${pad2(e.photo + 1)} is ${e.hero}` });
        break;
      case "cut":
        out.push({
          key: e.key,
          t,
          src: "SAM 3.1",
          text: `ch${pad2(e.photo + 1)} ${e.ok ? (e.moving ? "tracked through the clip" : "cut out") : "no clean cut"}: ${seen[e.photo]?.hero ?? e.hero}`,
          tone: e.ok ? undefined : "dim",
        });
        break;
      case "genre":
        out.push({ key: e.key, t, src: "WONDER", text: `${e.genre} / ${e.bpm} bpm / ${e.musicKey}`, tone: "vu" });
        break;
      case "title":
        out.push({ key: e.key, t, src: "WONDER", text: `title: ${e.title}` });
        break;
      case "line":
        lines += 1;
        break;
      case "band":
        if (lines) {
          out.push({ key: `lines-${lines}`, t, src: "WONDER", text: `lyric sheet: ${lines} lines` });
          lines = 0;
        }
        out.push({ key: e.key, t, src: "CASTING", text: `ch${pad2(e.photo + 1)} ${e.hero}: ${e.role}` });
        break;
      case "take":
      {
        const k = w.takes[e.index];
        out.push({ key: e.key, t, src: "ACE-STEP", text: `take ${e.index + 1} on tape` });
        if (k && typeof k.inKey === "number")
          out.push({
            key: `${e.key}-tune`,
            t,
            src: "DEMUCS",
            text: `take ${e.index + 1}: ${Math.round(k.inKey * 100)}% of the singing on the band's ${k.bandKey ?? "key"}${k.vocalKey ? `, singer in ${k.vocalKey}` : ""}`,
            tone: k.inKey < IN_KEY ? "tally" : "cue",
          });
        else if (k) out.push({ key: `${e.key}-tune`, t, src: "DEMUCS", text: `take ${e.index + 1}: no reading`, tone: "dim" });
        break;
      }
      case "cover":
        out.push({ key: e.key, t, src: "IMAGE 1.0", text: "the sleeve is painted", tone: "vu" });
        break;
      case "directed":
        out.push({ key: e.key, t, src: "SPARK 1.3", text: `the video's shot list: ${e.shots} shots` });
        break;
      case "timed":
        out.push({
          key: e.key,
          t,
          src: "MMS",
          text: `${e.words} words timed on the vocal, ${e.lines} of ${e.of} lines`,
          tone: "cue",
        });
        break;
      case "verdict": {
        const k = w.takes[e.index];
        if (!k) break;
        out.push({
          key: e.key,
          t,
          src: k.cut ? "TUNER" : "SPARK 1.2",
          text: k.cut ? `take ${e.index + 1} cut before a&r` : `take ${e.index + 1} scores ${k.score?.toFixed(2)}${k.kept ? ". kept" : ""}`,
          tone: k.kept ? "tally" : k.cut ? "dim" : undefined,
        });
        break;
      }
    }
  }
  if (lines) out.push({ key: `lines-${lines}`, t: out.length ? out[out.length - 1].t : "+00:00.0", src: "WONDER", text: `lyric sheet: ${lines} lines` });
  return out.slice(-6);
}
