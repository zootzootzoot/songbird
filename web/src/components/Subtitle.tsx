import type { CSSProperties } from "react";
import type { Line } from "../lib/types";

/**
 * The line under the machine. Set big, like a film subtitle: what the deck is
 * doing, and while the tape plays, the words as they are sung.
 */
export function Subtitle({
  kicker,
  text,
  sub,
  line,
  time,
  tone = "plain",
  stamp = null,
}: {
  kicker?: string;
  text?: string;
  sub?: string;
  line?: Line | null;
  time?: number;
  tone?: "plain" | "work" | "song" | "warn" | "call" | "consider" | "verdict";
  stamp?: { kept: boolean } | null;
}) {
  const key = line ? `line-${line.start}` : `text-${text}`;
  return (
    <div className="subtitle" data-tone={tone} aria-live="polite">
      {kicker && <p className="subtitle__kicker">{kicker}</p>}
      <p className="subtitle__text" key={key}>
        {line && time !== undefined
          ? line.words.map((w, i) => {
              const p = Math.min(1, Math.max(0, (time - w.start) / Math.max(0.05, w.end - w.start)));
              return (
                <span key={i} className="sung" data-on={time >= w.start} style={{ ["--p" as string]: p } as CSSProperties}>
                  {w.text}
                  {i < line.words.length - 1 ? " " : ""}
                </span>
              );
            })
          : text}
      </p>
      {sub && (
        <p className="subtitle__sub" key={`sub-${sub}`}>
          {sub}
        </p>
      )}
      {stamp && (
        <span className="subtitle__stamp" data-kept={stamp.kept} key={`stamp-${text}`}>
          {stamp.kept ? "kept" : "rejected"}
        </span>
      )}
    </div>
  );
}
