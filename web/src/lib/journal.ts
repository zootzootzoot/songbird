import type { Tape } from "./types";

/** Your own releases, kept on this device: the journal. Never required, never shared. */
export type Entry = { id: string; title: string; genre?: string; cover: string | null; catalog?: string; at: string };

const KEY = "songbird.journal.v1";

export function readJournal(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Entry[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

export function keep(t: Tape): Entry[] {
  const entry: Entry = { id: t.id, title: t.title, genre: t.genre, cover: t.cover, catalog: t.catalog, at: t.createdAt };
  const next = [entry, ...readJournal().filter((e) => e.id !== t.id)].slice(0, 365);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the release still exists, it just isn't remembered here */
  }
  return next;
}

/** "tue 3 nov" */
export function day(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toLowerCase().replace(",", "");
}
