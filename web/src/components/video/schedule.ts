import type { Line, Tape } from "../../lib/types";

/**
 * The video's timeline. The band's lyric timestamps are good when they are good and clumped when they are not
 * (several lines stamped at the same second). We keep every stamp that leaves room to sing the lines before it
 * (anchors) and spread the clumped lines across the gap between anchors, then time the words ourselves at the
 * song's pace. Everything downstream reads cues, never raw lines.
 */
export type CueWord = { text: string; start: number; end: number };

export type Cue = {
  index: number;
  /** index into tape.lines (and tape.direction.shots) */
  line: number;
  text: string;
  section: string;
  kind: Line["kind"];
  chorus: boolean;
  photo: number | null;
  /** sung window */
  start: number;
  end: number;
  /** held on screen through the breath before the next line */
  until: number;
  words: CueWord[];
  /** first time this photo fronts a line: introduce them */
  intro: boolean;
  /** frontman side for verse lines: 0 = left, 1 = right */
  side: 0 | 1;
};

export type Timeline = {
  cues: Cue[];
  /** where the video opens: a few bars before the first vocal, on a bar line (0 for a short intro) */
  openAt: number;
  /** the band's roll call runs from here to the first vocal (titleEnd); equal to titleEnd when there's no room */
  rollFrom: number;
  /** title card holds until here */
  titleEnd: number;
  /** credits roll from here to `end` */
  creditsStart: number;
  end: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** rough syllable weight, so "freckles" holds longer than "at" */
function weight(w: string) {
  const letters = w.replace(/[^a-z]/gi, "");
  const vowels = (letters.match(/[aeiouy]+/gi) ?? []).length;
  return 0.6 + Math.max(1, vowels) * 0.7 + letters.length * 0.05;
}

/** seconds of the song before the first vocal that the video keeps */
const OPEN = 5.5;

export function buildTimeline(tape: Tape, duration: number): Timeline {
  const source = tape.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.text && l.text.trim());
  const lines = source.map(({ l }) => l);
  const n = lines.length;
  const end = Math.max(duration, 1);
  if (!n) return { cues: [], openAt: 0, rollFrom: Math.min(8, end * 0.4), titleEnd: Math.min(8, end * 0.4), creditsStart: Math.max(end * 0.5, end - 14), end };

  const spb = 60 / (tape.bpm > 30 ? tape.bpm : 100);
  // a word every beat at ballad tempo, every half-ish beat when it's fast
  const spw = clamp(spb > 0.55 ? spb : spb * 1.05, 0.3, 0.78);
  const words = lines.map((l) => tokens(l.text));
  const need = words.map((w) => clamp(w.length * spw * 0.92, 1.3, 5.2));
  // a line whose words were placed on the singing (forced alignment on the vocal stem) is played exactly as timed
  const timed = lines.map((l) => {
    const ws = l.words ?? [];
    return (
      l.timing === "aligned" &&
      ws.length > 0 &&
      ws.every((w, k) => Number.isFinite(w.start) && Number.isFinite(w.end) && (k === 0 || w.start >= ws[k - 1].start - 0.01))
    );
  });
  const raw = lines.map((l, i) =>
    timed[i] ? Math.max(0, l.words[0].start) : Number.isFinite(l.start) ? Math.max(0, l.start) : NaN,
  );

  // anchors: real stamps, plus heard stamps that leave room for everything sung since the last anchor
  const anchors: number[] = [0];
  if (!Number.isFinite(raw[0])) raw[0] = 0;
  let due = raw[0] + need[0];
  for (let i = 1; i < n; i += 1) {
    const s = raw[i];
    if (timed[i] && s < end - 0.5 && s > raw[anchors[anchors.length - 1]]) {
      anchors.push(i);
      due = s + need[i];
    } else if (Number.isFinite(s) && s >= due - 0.3 && s < end - 0.5) {
      anchors.push(i);
      due = s + need[i];
    } else {
      due += need[i];
    }
  }

  const starts = new Array<number>(n).fill(0);
  for (let a = 0; a < anchors.length; a += 1) {
    const i0 = anchors[a];
    const i1 = a + 1 < anchors.length ? anchors[a + 1] : n;
    const s0 = raw[i0];
    let s1: number;
    if (i1 < n) s1 = raw[i1];
    else {
      const lastEnd = Number.isFinite(lines[n - 1].end) ? lines[n - 1].end : 0;
      let total = 0;
      for (let k = i0; k < n; k += 1) total += need[k];
      s1 = clamp(Math.max(lastEnd, s0 + total), s0 + total * 0.6, end - 0.3);
      if (s1 <= s0) s1 = s0 + total;
    }
    let total = 0;
    for (let k = i0; k < i1; k += 1) total += need[k];
    let acc = 0;
    for (let k = i0; k < i1; k += 1) {
      starts[k] = s0 + ((s1 - s0) * acc) / total;
      acc += need[k];
    }
  }

  const cues: Cue[] = [];
  const seen = new Set<number>();
  let side: 0 | 1 = 1;
  let lastFront: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const l = lines[i];
    const start = starts[i];
    const next = i + 1 < n ? starts[i + 1] : Math.min(end, start + need[i] * 2.2);
    const anchored = anchors.includes(i);
    const exact = timed[i] && anchored;
    let lineEnd: number;
    let cw: CueWord[];
    if (exact) {
      // the words land where they were sung; the line holds a breath past its last word
      const ws = l.words;
      const last = ws[ws.length - 1].end;
      lineEnd = clamp(last + 0.15, start + 0.6, Math.max(start + 0.6, next - 0.04));
      cw = ws.map((w, k) => ({
        text: w.text,
        start: Math.max(start, w.start),
        end: Math.min(Math.max(w.end, w.start + 0.08), k + 1 < ws.length ? ws[k + 1].start : lineEnd),
      }));
    } else {
      const rawEnd = anchored && Number.isFinite(l.end) && l.end > start + 0.4 ? l.end : start + need[i] * 1.25;
      lineEnd = clamp(Math.max(rawEnd, start + need[i]), start + 0.6, Math.max(start + 0.6, next - 0.04));
      // no word times: sing the words at pace from the line's start, never slower than the window allows
      const ws = words[i];
      const singFor = Math.min(lineEnd - start, ws.length * spw * 1.12 + 0.25);
      const totalW = ws.reduce((s, w) => s + weight(w), 0) || 1;
      let at = start;
      cw = ws.map((w) => {
        const d = (singFor * weight(w)) / totalW;
        const word = { text: w, start: at, end: at + d };
        at += d;
        return word;
      });
    }
    const until = Math.max(lineEnd, Math.min(next, lineEnd + 1.2));

    const photo = l.photo != null && l.photo >= 0 && l.photo < tape.photos.length ? l.photo : null;
    const chorus = l.kind === "chorus" || l.kind === "refrain" || /chorus|refrain|hook/i.test(l.section ?? "");
    if (photo != null && !chorus && photo !== lastFront) {
      side = side === 0 ? 1 : 0;
      lastFront = photo;
    }
    const intro = photo != null && !seen.has(photo);
    if (photo != null) seen.add(photo);
    cues.push({
      index: i,
      line: source[i].i,
      text: l.text,
      section: l.section ?? "",
      kind: l.kind,
      chorus,
      photo,
      start,
      end: lineEnd,
      until,
      words: cw,
      intro,
      side,
    });
  }

  // the cold open: nobody should wait through a long instrumental intro. Open OPEN seconds before the first vocal,
  // cut on a bar line; the title lands first, then the band is called onto the stage one member per beat
  const first = cues[0].start;
  const bar = spb * 4;
  // room for a short title and a roll call that gives each member two beats in the spotlight
  const members = new Set(cues.map((c) => c.photo).filter((p) => p != null)).size || tape.photos.length;
  const want = Math.min(9, Math.max(OPEN, 1.4 + (members + 0.5) * 2 * spb));
  const bars = Math.max(1, Math.ceil(want / bar - 0.15));
  const openAt = first - bars * bar > 1.5 ? first - bars * bar : 0;
  const titleEnd = Math.max(first - 0.05, openAt + 2.5);
  const room = titleEnd - openAt;
  // a short title (about a fifth of the opening, at least 1.2 s, on a beat); the rest is the roll call
  let rollFrom = openAt + Math.ceil(Math.max(1.2, room * 0.2) / spb) * spb;
  if (titleEnd - rollFrom < 1.2) rollFrom = titleEnd;
  const last = cues[cues.length - 1];
  const creditsStart = clamp(Math.min(last.end + 0.6, end - 14), Math.min(titleEnd + 6, end - 4), end - 4);
  return { cues, openAt, rollFrom, titleEnd, creditsStart, end };
}

/** the cue on screen at t (held through its breath), or -1 */
export function cueAt(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start - 0.12 <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  return t < cues[found].until ? found : -1;
}

/** the last cue started at or before t, or -1 */
export function lastCueAt(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start - 0.12 <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export type Member = { photo: number; name: string; role: string };

/** "the yellow rain boots: lead percussion, puddle division" -> name + role; older tapes only have the role */
export function members(tape: Tape): Member[] {
  return tape.photos.map((p, i) => {
    const credit = tape.band?.find((b) => b.photo === i)?.role?.trim() ?? "";
    const m = credit.match(/^([^:]{2,70}):\s*(.+)$/);
    const hero = (p.hero || "the band").trim();
    if (m) return { photo: i, name: m[1].trim(), role: m[2].trim() };
    return { photo: i, name: /^the\s/i.test(hero) ? hero : `the ${hero}`, role: credit };
  });
}

export function clock(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** small deterministic hash for per-word art direction */
export function hash(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
