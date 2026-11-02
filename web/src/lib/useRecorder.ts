import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError, transcribe } from "./api";

export type RecState = "idle" | "asking" | "recording" | "hearing" | "denied" | "error";

const MAX_MS = 60_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m));
}

/**
 * Hold to talk. Press starts a MediaRecorder, release posts the clip to
 * /api/transcribe (Muse Voice Transcribe) and hands back the text.
 */
export function useRecorder(onText: (text: string) => void) {
  const [state, setState] = useState<RecState>("idle");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const held = useRef(false);
  const timer = useRef(0);
  const raf = useRef(0);
  const startedAt = useRef(0);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    window.clearTimeout(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback(async (blob: Blob) => {
    setState("hearing");
    setMessage("");
    try {
      const text = await transcribe(blob);
      if (!text) {
        setState("error");
        setMessage("it didn't catch any words. try again, a little closer.");
        return;
      }
      onText(text);
      setState("idle");
    } catch (err) {
      if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
        onText("she named the snail gary");
        setState("idle");
        return;
      }
      setState("error");
      setMessage(err instanceof HttpError ? err.message : "it didn't catch that. try again, or type it.");
    }
  }, [onText]);

  const start = useCallback(async () => {
    if (!supported) {
      setState("error");
      setMessage("this browser can't record. type it instead.");
      return;
    }
    if (rec.current) return;
    held.current = true;
    setMessage("");
    setState("asking");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      held.current = false;
      const name = (err as DOMException)?.name;
      setState("denied");
      setMessage(
        name === "NotFoundError"
          ? "no microphone found. type it instead."
          : "the deck can't hear you. the mic is off for this page. type it instead.",
      );
      return;
    }
    if (!held.current) {
      // released while the browser was asking: permission is granted now
      s.getTracks().forEach((t) => t.stop());
      setState("idle");
      setMessage("the mic is on. hold the button while you talk.");
      return;
    }
    stream.current = s;
    chunks.current = [];
    const mime = pickMime();
    const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
    rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      rec.current = null;
      cleanup();
      if (performance.now() - startedAt.current < 500 || blob.size < 1200) {
        setState("idle");
        setMessage("hold it down while you talk.");
        return;
      }
      void finish(blob);
    };
    // a small level meter so you can see it is listening
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128));
        setLevel(Math.min(1, peak / 60));
        if (stream.current) raf.current = requestAnimationFrame(loop);
        else void ctx.close();
      };
      loop();
    } catch {
      /* the meter is a nicety */
    }
    startedAt.current = performance.now();
    r.start(250);
    setState("recording");
    timer.current = window.setTimeout(() => r.state !== "inactive" && r.stop(), MAX_MS);
  }, [supported, cleanup, finish]);

  const stop = useCallback(() => {
    held.current = false;
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  return { state, message, level, start, stop, supported };
}
