import ada from "../fixtures/ada.json";
import ivy from "../fixtures/ivy.json";
import { apiUrl, asset, loadLiveConfig, media, staticMedia, studioClosedByConfig } from "./env";
import { EVENT_TYPES, type SongEvent, type Tape, type TapeSummary } from "./types";

/** apply a URL mapper to every media URL in a tape */
export function rebase(tape: Tape, map: (u: string | null) => string | null): Tape {
  return {
    ...tape,
    audio: map(tape.audio) ?? "",
    cover: map(tape.cover),
    takes: tape.takes?.map((t) => ({ ...t, audio: map(t.audio) ?? t.audio })),
    photos: tape.photos.map((p) => ({
      ...p,
      src: map(p.src) ?? p.src,
      cutout: map(p.cutout),
      motion: map(p.motion ?? null),
      clip: map(p.clip ?? null),
    })),
  };
}

/** SB-0007, hand-made in the new format over real photos and SAM cutouts (no recording yet) */
export const FIXTURE = rebase(ada as unknown as Tape, staticMedia);
/** SB-0006, with a clip and a moving sticker; the dev mock replays it for the sample roll */
export const MOTION_FIXTURE = rebase(ivy as unknown as Tape, staticMedia);

/** tapes the deck has seen this session, so print / permalink work without a refetch */
const memory = new Map<string, Tape>([[FIXTURE.id, FIXTURE]]);

export function remember(tape: Tape) {
  memory.set(tape.id, tape);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    window.clearTimeout(t);
  }
}

export type Health = { ok: boolean; meta: boolean; band?: boolean; singer?: boolean; busy?: boolean };

/** read live.json, then ping the studio. null means closed. */
export async function connect(): Promise<Health | null> {
  await loadLiveConfig();
  if (studioClosedByConfig()) return null;
  try {
    const res = await fetchWithTimeout(apiUrl("/api/health"), 4000);
    if (!res.ok || !isJson(res)) return null;
    const h = (await res.json()) as Health;
    return h && h.ok ? h : null;
  } catch {
    return null;
  }
}

export async function createTape(
  photos: { blob: Blob; name: string }[],
  name: string,
  note: string,
  noteSpoken = false,
): Promise<{ id: string }> {
  const form = new FormData();
  photos.forEach((p) => form.append("photos", p.blob, p.name));
  if (name.trim()) form.append("name", name.trim());
  if (note.trim()) {
    form.append("note", note.trim());
    if (noteSpoken) form.append("note_spoken", "true");
  }
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/tapes"), { method: "POST", body: form });
  } catch {
    throw new HttpError(0, "the deck can't reach the recording studio right now.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : typeof body?.message === "string" ? body.message : "";
    } catch {
      /* not json */
    }
    if (res.status >= 500) throw new HttpError(res.status, detail || "the recording studio isn't answering right now.");
    throw new HttpError(res.status, detail || `the studio said no (${res.status}).`);
  }
  return res.json();
}

/** Muse Voice Transcribe, via the server */
export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : audio.type.includes("wav") ? "wav" : "webm";
  form.append("audio", audio, `note.${ext}`);
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/transcribe"), { method: "POST", body: form });
  } catch {
    throw new HttpError(0, "couldn't reach the studio to listen. type it instead.");
  }
  if (!res.ok || !isJson(res)) throw new HttpError(res.status, "it didn't catch that. try again, or type it.");
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

async function staticTape(id: string): Promise<Tape | null> {
  try {
    const res = await fetch(asset(`tapes/${encodeURIComponent(id)}/tape.json`));
    if (!res.ok || !isJson(res)) return null;
    return rebase((await res.json()) as Tape, staticMedia);
  } catch {
    return null;
  }
}

/** A finished tape: static copy first, then the studio. null = not finished (404). */
export async function getTape(id: string): Promise<Tape | null> {
  const known = memory.get(id);
  if (known) return known;
  const local = await staticTape(id);
  if (local) {
    memory.set(id, local);
    return local;
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/tapes/${encodeURIComponent(id)}`));
  } catch {
    throw new HttpError(0, "the studio is closed, and that tape isn't on the shelf.");
  }
  if (res.status === 404) return null;
  if (!res.ok || !isJson(res)) throw new HttpError(res.status, `couldn't fetch that tape (${res.status}).`);
  const tape = rebase((await res.json()) as Tape, media);
  memory.set(tape.id, tape);
  return tape;
}

function summaryFix(t: TapeSummary, map: (u: string | null) => string | null): TapeSummary {
  return {
    ...t,
    cover: map(t.cover ?? null),
    photos: t.photos?.map((p) => ({ ...p, src: map(p.src) ?? p.src, cutout: map(p.cutout ?? null) })),
  };
}

/** the shelf: static copies first (works with the studio closed), then the studio's samples */
export async function getShelf(): Promise<TapeSummary[]> {
  try {
    const res = await fetch(asset("tapes/shelf.json"));
    if (res.ok && isJson(res)) {
      const body = (await res.json()) as { tapes?: TapeSummary[] };
      const tapes = (body.tapes ?? []).filter((t) => t && typeof t.id === "string");
      if (tapes.length) return tapes.map((t) => summaryFix(t, staticMedia));
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetchWithTimeout(apiUrl("/api/samples"), 5000);
    if (res.ok && isJson(res)) {
      const body = (await res.json()) as { tapes?: TapeSummary[] };
      return (body.tapes ?? []).filter((t) => t && typeof t.id === "string").map((t) => summaryFix(t, media));
    }
  } catch {
    /* nothing */
  }
  return [];
}

/**
 * Subscribe to a tape's event stream. The server replays everything on
 * (re)connect, so handlers must be idempotent; ours are keyed by index.
 * Media URLs in events are made absolute against the studio. Returns close().
 */
export function openEvents(id: string, onEvent: (event: SongEvent) => void, onLost: () => void): () => void {
  const es = new EventSource(apiUrl(`/api/tapes/${encodeURIComponent(id)}/events`));
  let finished = false;
  let failures = 0;

  const fix = (ev: SongEvent): SongEvent => {
    if (ev.type === "cut") return { ...ev, cutout: media(ev.cutout), motion: media(ev.motion ?? null), clip: media(ev.clip ?? null) };
    if (ev.type === "take") return { ...ev, audio: media(ev.audio) ?? ev.audio };
    if (ev.type === "done") return { ...ev, tape: rebase(ev.tape, media) };
    return ev;
  };

  const deliver = (ev: SongEvent) => {
    if (ev.type === "done" || ev.type === "error") {
      finished = true;
      es.close();
    }
    onEvent(fix(ev));
  };

  const handle = (type: SongEvent["type"]) => (raw: Event) => {
    const msg = raw as MessageEvent;
    if (type === "error" && !(typeof msg.data === "string" && msg.data.length)) {
      // the transport's own error event, not the server's
      if (finished) return;
      failures += 1;
      if (es.readyState === EventSource.CLOSED || failures > 6) {
        es.close();
        onLost();
      }
      return;
    }
    failures = 0;
    try {
      deliver({ ...JSON.parse(msg.data), type } as SongEvent);
    } catch {
      /* ignore a bad frame */
    }
  };

  EVENT_TYPES.forEach((type) => es.addEventListener(type, handle(type)));
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as SongEvent;
      if (data && typeof data.type === "string") deliver(data);
    } catch {
      /* ignore */
    }
  };

  return () => {
    finished = true;
    es.close();
  };
}
