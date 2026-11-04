import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, studioClosedByConfig } from "./env";

/**
 * The shareable MP4 (9:16 music video with the song), cut by the studio's recorder.
 * A live release starts cutting on its own; for anything else, asking for it starts the cut.
 * On a phone it goes to the share sheet as a file (Reels, Stories, a group chat); elsewhere it downloads.
 */
export type ShareState = "none" | "queued" | "filming" | "encoding" | "ready" | "error" | "closed";

export function useShareVideo(id: string, name: string) {
  const [state, setState] = useState<ShareState>("none");
  const [progress, setProgress] = useState(0);
  const want = useRef(false); // deliver as soon as it's ready
  const timer = useRef(0);

  const deliver = useCallback(async () => {
    const url = apiUrl(`/api/tapes/${encodeURIComponent(id)}/share.mp4`);
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && nav.canShare) {
      try {
        const blob = await fetch(url).then((r) => r.blob());
        const file = new File([blob], `songbird-${name}.mp4`, { type: "video/mp4" });
        if (nav.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      } catch {
        /* the share sheet was closed, or can't take files: download instead */
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `songbird-${name}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [id, name]);

  const poll = useCallback(async () => {
    window.clearTimeout(timer.current);
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

  const label =
    state === "ready"
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
  return { state, progress, label, ask, busy: state === "queued" || state === "filming" || state === "encoding" };
}
