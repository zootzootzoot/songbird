import { useCallback, useEffect, useRef, useState } from "react";
import { MACHINE_LINES, SAMPLE_PHOTOS, SONG, type SamplePhoto } from "./song";
import { SoundKit } from "./audio";

export type Phase = "empty" | "loaded" | "working" | "done" | "revealed" | "playing";
export type BirdMood = "sleep" | "alert" | "proud" | "bob";

export type Photo = { src: string; alt: string; note?: string };

const STEP_MS = 1500;
const MAX_PHOTOS = 6;

export function useSongbird() {
  const [phase, setPhase] = useState<Phase>("empty");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [name, setNameState] = useState("");
  const [reading, setReading] = useState(-1);
  const [printed, setPrinted] = useState(0);
  const [retake, setRetake] = useState(false);
  const [activeLine, setActiveLine] = useState(-1);
  const [mood, setMood] = useState<BirdMood>("sleep");
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(false);

  const soundRef = useRef<SoundKit | null>(null);
  const timers = useRef<number[]>([]);
  const objectUrls = useRef<string[]>([]);
  const phaseRef = useRef<Phase>("empty");
  const photoCount = useRef(0);
  const photosRef = useRef<Photo[]>([]);

  phaseRef.current = phase;
  photoCount.current = photos.length;
  photosRef.current = photos;

  const kit = useCallback(() => {
    if (!soundRef.current) soundRef.current = new SoundKit();
    soundRef.current.ensure();
    return soundRef.current;
  }, []);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      soundRef.current?.stopSong();
      soundRef.current?.stopMotor();
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const setName = useCallback((value: string) => {
    setNameState(value.slice(0, 16));
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const addPhotos = useCallback((incoming: Photo[]) => {
    if (phaseRef.current === "working") return;
    const current = photosRef.current;
    const existing = new Set(current.map((p) => p.src));
    const next = [...current];
    for (const photo of incoming) {
      if (next.length >= MAX_PHOTOS) break;
      if (existing.has(photo.src)) continue;
      existing.add(photo.src);
      next.push(photo);
    }
    const added = next.length - current.length;
    if (!added) return;
    photosRef.current = next;
    setPhotos(next);
    for (let i = 0; i < added; i += 1) {
      window.setTimeout(() => soundRef.current?.paper(), i * 95);
    }
    setPhase((p) => (p === "empty" ? "loaded" : p));
    setMood("alert");
    setProgress((p) => Math.max(p, 0.04));
  }, []);

  const addSample = useCallback(() => {
    kit();
    addPhotos(SAMPLE_PHOTOS.map((p: SamplePhoto) => ({ src: p.src, alt: p.alt, note: p.note })));
    later(() => soundRef.current?.thunk(), 260);
  }, [addPhotos, kit, later]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (!list.length) return;
      const next = list.slice(0, MAX_PHOTOS).map((file) => {
        const url = URL.createObjectURL(file);
        objectUrls.current.push(url);
        return { src: url, alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") };
      });
      addPhotos(next);
    },
    [addPhotos],
  );

  const finish = useCallback(() => {
    clearTimers();
    soundRef.current?.stopMotor();
    soundRef.current?.bell();
    soundRef.current?.setRoomTone(1);
    setReading(-1);
    setPrinted(SONG.lyrics.length);
    setProgress(1);
    setRetake(false);
    setMood("proud");
    setPhase("done");
    later(() => {
      soundRef.current?.paper();
      setPhase("revealed");
    }, 1600);
  }, [clearTimers, later]);

  const pullLever = useCallback(() => {
    const current = phaseRef.current;
    if (current === "working" || !photoCount.current) return;
    kit();
    soundRef.current?.stopSong();
    soundRef.current?.thunk();
    soundRef.current?.startMotor();
    soundRef.current?.setRoomTone(0.25);

    clearTimers();
    setPhase("working");
    setMood("alert");
    setReading(-1);
    setPrinted(0);
    setRetake(false);
    setActiveLine(-1);
    setProgress(0.05);

    const count = Math.min(photoCount.current, MAX_PHOTOS);
    let at = 850;

    for (let i = 0; i < count; i += 1) {
      if (i === 2) {
        later(() => {
          setRetake(true);
          setReading(2);
          setProgress(0.3);
          soundRef.current?.rewind();
        }, Math.max(120, at - 420));
        later(() => {
          setRetake(false);
          soundRef.current?.clack();
        }, at + 720);
        at += 900;
      }
      later(() => {
        setReading(i);
        setPrinted(i + 1);
        setProgress(0.08 + ((i + 1) / count) * 0.84);
        soundRef.current?.clack();
        soundRef.current?.print();
        setMood(i === count - 1 ? "proud" : "alert");
      }, at);
      at += STEP_MS;
    }

    later(finish, at + 450);
  }, [clearTimers, finish, kit, later]);

  const hurry = useCallback(() => {
    if (phaseRef.current !== "working") return;
    clearTimers();
    soundRef.current?.clack();
    setReading(photoCount.current - 1);
    setPrinted(SONG.lyrics.length);
    setRetake(false);
    later(finish, 300);
  }, [clearTimers, finish, later]);

  const play = useCallback(() => {
    const current = phaseRef.current;
    if (current !== "revealed" && current !== "done" && current !== "playing") return;
    kit();
    soundRef.current?.key();
    soundRef.current?.startMotor();
    soundRef.current?.setRoomTone(1);
    setPhase("playing");
    setMood("bob");
    soundRef.current?.startSong((line) => setActiveLine(line));
  }, [kit]);

  const stop = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    soundRef.current?.key();
    soundRef.current?.stopSong();
    soundRef.current?.stopMotor();
    setPhase("revealed");
    setMood("proud");
    setActiveLine(-1);
  }, []);

  const eject = useCallback(() => {
    if (phaseRef.current === "working") return;
    soundRef.current?.clack();
    soundRef.current?.stopSong();
    soundRef.current?.stopMotor();
    clearTimers();
    setPhase(photoCount.current ? "loaded" : "empty");
    setMood(photoCount.current ? "alert" : "sleep");
    setPrinted(0);
    setActiveLine(-1);
    setReading(-1);
    setRetake(false);
    setProgress(0.04);
  }, [clearTimers]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      soundRef.current?.setMuted(next);
      return next;
    });
  }, []);

  return {
    phase,
    photos,
    name,
    setName,
    reading,
    printed,
    retake,
    activeLine,
    mood,
    progress,
    muted,
    lines: MACHINE_LINES,
    lyrics: SONG.lyrics,
    canPull: photos.length > 0 && phase !== "working",
    addSample,
    addFiles,
    pullLever,
    hurry,
    play,
    stop,
    eject,
    toggleMuted,
  };
}

export type Songbird = ReturnType<typeof useSongbird>;
