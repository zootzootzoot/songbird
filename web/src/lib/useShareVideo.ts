import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, asset, studioClosedByConfig } from "./env";

/**
 * The shareable MP4 (9:16 music video with the song), cut by the studio's recorder.
 * A live release starts cutting on its own; for anything else, asking for it starts the cut.
 * On a phone it goes to the share sheet as a file (Reels, Stories, a group chat); elsewhere it downloads.
 * The shelf's MP4s are also published with the site, so they save even when the studio is closed (and come from a CDN).
 */
export type ShareState = "none" | "queued" | "filming" | "encoding" | "ready" | "error" | "closed";

export function useShareVideo(id: string, name: string) {
  const [state, setState] = useState<ShareState>("none");
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const want = useRef(false); // deliver as soon as it's ready
  const timer = useRef(0);
  const published = useRef<{ id: string; url: string | null } | null>(null); // the copy on the site, once looked for

  const deliver = useCallback(async () => {
    const url = (published.current?.id === id ? published.current.url : null) ?? apiUrl(`/api/tapes/${encodeURIComponent(id)}/share.mp4`);
    const filename = `songbird-${name}.mp4`;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const touch = matchMedia("(pointer: coarse)").matches;
    setSaving(true);
    try {
      // as a blob, so the file keeps its name even when it comes from the studio's own origin
      const blob = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      const file = new File([blob], filename, { type: "video/mp4" });
      if (touch && nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch {
          /* the share sheet was closed, or can't take files: download instead */
        }
      }
      const href = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      window.open(url, "_blank", "noopener"); // last resort: the browser's own player, which can save it
    } finally {
      setSaving(false);
    }
  }, [id, name]);

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (published.current?.id !== id) {
      published.current = { id, url: null };
      try {
        const u = asset(`tapes/${encodeURIComponent(id)}/share.mp4`);
        const r = await fetch(u, { method: "HEAD", cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") ?? "").includes("video")) published.current = { id, url: u };
      } catch {
        /* not published with the site */
      }
    }
    if (published.current.url) {
      setState("ready");
      setProgress(1);
      if (want.current) {
        want.current = false;
        void deliver();
      }
      return;
    }
    if (studioClosedByConfig()) {
      setState("closed");
      return;
    }
    try {
      const r = await fetch(apiUrl(`/api/tapes/${encodeURIComponent(id)}/share`));
      if (!r.ok) throw new Error(String(r.status));
      const s = (await r.json()) as { state: ShareState; progress?: number };
      setState(s.state);
      setProgress(s.progress ?? 0);
      if (s.state === "ready" && want.current) {
        want.current = false;
        void deliver();
      }
      if (s.state === "queued" || s.state === "filming" || s.state === "encoding")
        timer.current = window.setTimeout(() => void poll(), 2000);
    } catch {
      setState("closed");
    }
  }, [id, deliver]);

  useEffect(() => {
    void poll();
    return () => window.clearTimeout(timer.current);
  }, [poll]);

  const ask = useCallback(async () => {
    if (state === "ready") return deliver();
    want.current = true;
    if (state === "none" || state === "error") {
      try {
        await fetch(apiUrl(`/api/tapes/${encodeURIComponent(id)}/share`), { method: "POST" });
      } catch {
        setState("closed");
        return;
      }
    }
    void poll();
  }, [state, id, deliver, poll]);

  const label = saving
    ? "Saving the video…"
    : state === "ready"
      ? "Save the video"
      : state === "queued"
        ? "Cutting the video…"
        : state === "filming" || state === "encoding"
          ? `Cutting the video ${Math.round(progress * 100)}%`
          : state === "closed"
            ? "Video needs the studio"
            : state === "error"
              ? "Try the video again"
              : "Make the video";
  return { state, progress, label, ask, busy: saving || state === "queued" || state === "filming" || state === "encoding" };
}
