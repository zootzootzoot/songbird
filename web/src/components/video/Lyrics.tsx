import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { hash, type Cue } from "./schedule";
import type { Theme } from "./themes";

type Chip = { text: string; style: CSSProperties; cls: string };
type Deco = {
  /** per word: style vars + classes, and for the ransom note, per-letter chips */
  words: { style: CSSProperties; cls: string; chips: Chip[] | null }[];
  /** Reid Miles rows (stack lyric): word index ranges with a size */
  rows: { from: number; to: number; style: CSSProperties }[] | null;
  section: string | null;
  style: CSSProperties;
};

const v = (o: Record<string, string | number>) => o as CSSProperties;

function decorate(cues: Cue[], theme: Theme): Deco[] {
  return cues.map((cue, ci) => {
    const prev = ci > 0 ? cues[ci - 1] : null;
    const section = !prev || prev.section !== cue.section ? cue.section || null : null;
    const n = cue.words.length;
    const words = cue.words.map((w, k) => {
      const seed = `${cue.index}:${k}:${w.text}`;
      if (theme.family === "zine") {
        const h1 = hash(seed, 1);
        const h2 = hash(seed, 2);
        const h3 = hash(seed, 3);
        const letters = w.text.replace(/[^\p{L}\p{N}']/gu, "").length;
        const split = hash(seed, 4) < (theme.variant === "punk" ? 0.42 : 0.22) && letters >= 2 && letters <= 6;
        const chips = split
          ? Array.from(w.text).map((ch, j) => {
              const s = `${seed}:${j}`;
              return {
                text: ch,
                cls: `f${Math.floor(hash(s, 5) * 5)} c${Math.floor(hash(s, 6) * 6)}`,
                style: v({ "--r": `${((hash(s, 7) - 0.5) * 18).toFixed(1)}deg`, "--y": `${((hash(s, 8) - 0.5) * 0.18).toFixed(2)}em` }),
              };
            })
          : null;
        return {
          cls: `f${Math.floor(h1 * 5)} c${Math.floor(h2 * 6)}`,
          style: v({ "--r": `${((h3 - 0.5) * 9).toFixed(1)}deg`, "--y": `${((hash(seed, 9) - 0.5) * 0.2).toFixed(2)}em`, "--k": k }),
          chips,
        };
      }
      if (theme.family === "bluenote") {
        return { cls: hash(seed, 1) < 0.28 ? "lite" : "", style: v({ "--k": k }), chips: null };
      }
      return { cls: "", style: v({ "--k": k, "--n": n }), chips: null };
    });

    let rows: Deco["rows"] = null;
    if (theme.lyric === "stack") {
      // greedy rows of up to ~11 characters; each row sized to fill the column
      rows = [];
      let from = 0;
      let chars = 0;
      cue.words.forEach((w, k) => {
        const len = w.text.length;
        if (k > from && chars + 1 + len > 11) {
          rows!.push({ from, to: k, style: {} });
          from = k;
          chars = len;
        } else chars += (k > from ? 1 : 0) + len;
      });
      rows.push({ from, to: cue.words.length, style: {} });
      const sizes = rows.map((r) => {
        const c = cue.words.slice(r.from, r.to).reduce((s, w) => s + w.text.length, 0) + (r.to - r.from - 1);
        return { c: Math.max(3, c), fs: Math.min(2.1, 9 / Math.max(3.5, c)) };
      });
      const sum = sizes.reduce((s, z) => s + z.fs * 0.9, 0);
      const unit = Math.min(15, 62 / sum);
      rows.forEach((r, i) => {
        r.style = v({ "--x": (unit * sizes[i].fs).toFixed(2), "--cw": (sizes[i].c * 0.47).toFixed(2) });
      });
    }
    return { words, rows, section, style: v({ "--n": n, "--chars": cue.text.length }) };
  });
}

function wordState(t: number, s: number, e: number) {
  return t < s ? "n" : t < e ? "on" : "p";
}

function Word({ cue, k, t, deco, theme }: { cue: Cue; k: number; t: number; deco: Deco; theme: Theme }) {
  const w = cue.words[k];
  const d = deco.words[k];
  const st = wordState(t, w.start, w.end);
  const style: CSSProperties = st === "on" ? { ...d.style, ["--p" as string]: ((t - w.start) / Math.max(0.05, w.end - w.start)).toFixed(3) } : d.style;
  let body: React.ReactNode = w.text;
  if (theme.lyric === "type") {
    const chars = Array.from(w.text);
    const shown = st === "p" ? chars.length : st === "n" ? 0 : Math.ceil(((t - w.start) / Math.max(0.05, w.end - w.start)) * chars.length);
    body = chars.map((c, j) => (
      <span key={j} className="c" data-v={j < shown ? 1 : 0}>
        {c}
      </span>
    ));
  } else if (d.chips) {
    body = d.chips.map((c, j) => (
      <span key={j} className={`chip ${c.cls}`} style={c.style}>
        {c.text}
      </span>
    ));
  }
  return (
    <span className={`w ${d.cls}${d.chips ? " split" : ""}`} data-s={st} style={style}>
      <span className="wi">{body}</span>
    </span>
  );
}

function LyricLine({ cue, deco, t, st, theme, layout }: { cue: Cue; deco: Deco; t: number; st: "in" | "out"; theme: Theme; layout: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // shrink to fit the lyric region: once per line and layout, and again when the theme fonts land
  useLayoutEffect(() => {
    if (st !== "in") return;
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const box = el.parentElement;
      const words = el.querySelector<HTMLElement>(".vl-words");
      if (!box || !words) return;
      let f = 1;
      el.style.setProperty("--fit", "1");
      for (let i = 0; i < 4; i += 1) {
        const sec = el.querySelector<HTMLElement>(".vl-sec");
        const pad = el.offsetHeight - el.clientHeight + (parseFloat(getComputedStyle(el).paddingTop) || 0) + (parseFloat(getComputedStyle(el).paddingBottom) || 0);
        const availH = box.clientHeight - (sec && getComputedStyle(sec).position !== "absolute" ? sec.offsetHeight + 12 : 0) - pad;
        const availW = box.clientWidth - (el.offsetWidth - el.clientWidth) - (parseFloat(getComputedStyle(el).paddingLeft) || 0) * 2;
        const h = words.scrollHeight;
        const w = words.scrollWidth;
        const r = Math.min(availH / Math.max(1, h), availW / Math.max(1, w));
        if (r >= 0.995) break;
        f *= Math.max(0.3, r * 0.97);
        el.style.setProperty("--fit", f.toFixed(3));
      }
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
    };
  }, [st, cue.index, layout]);
  const done = t >= cue.words[cue.words.length - 1]?.end;
  const words = cue.words.map((_, k) => <Word key={k} cue={cue} k={k} t={t} deco={deco} theme={theme} />);
  return (
    <div
      ref={ref}
      className={`vl-line${cue.chorus ? " is-chorus" : ""}`}
      data-st={st}
      data-kind={cue.kind}
      data-done={done ? 1 : 0}
      style={deco.style}
    >
      {deco.section && <div className="vl-sec">{deco.section}</div>}
      <div className="vl-words">
        {deco.rows
          ? deco.rows.map((r, i) => (
              <div className="vl-row" key={i} style={r.style}>
                {words.slice(r.from, r.to)}
              </div>
            ))
          : words}
      </div>
    </div>
  );
}

/** Word-timed lyrics: the current line, plus the last one on its way out. Theme CSS does the rest. */
export function Lyrics({ cues, cur, out, t, theme, layout }: { cues: Cue[]; cur: number; out: number; t: number; theme: Theme; layout: string }) {
  const decos = useMemo(() => decorate(cues, theme), [cues, theme]);
  return (
    <div className="vl" aria-live="off">
      {out >= 0 && out !== cur && <LyricLine key={`l${out}`} cue={cues[out]} deco={decos[out]} t={t} st="out" theme={theme} layout={layout} />}
      {cur >= 0 && <LyricLine key={`l${cur}`} cue={cues[cur]} deco={decos[cur]} t={t} st="in" theme={theme} layout={layout} />}
    </div>
  );
}
