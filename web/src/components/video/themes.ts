import { useEffect } from "react";
import type { Tape } from "../../lib/types";

/**
 * Genre themes for the video. DESIGN.md "Genre themes": the tape's `style` picks the family;
 * older tapes fall back to keywords in `genre`, then neon.
 */
export type Family = "neon" | "strut" | "deco" | "twotone" | "arena" | "zine" | "atomic" | "bluenote" | "milonga" | "bit";

export type Variant =
  | "synthwave"
  | "italo"
  | "funk"
  | "soul"
  | "bigband"
  | "ska"
  | "hard"
  | "ballad"
  | "punk"
  | "indie"
  | "rocknroll"
  | "surf"
  | "bossa"
  | "tango"
  | "salsa"
  | "chip";

export type Theme = {
  family: Family;
  variant: Variant;
  /** Google Fonts css2 `family=` specs */
  fonts: string[];
  /** lyric layout: words in a line, one word per row (Reid Miles), or typed letter by letter */
  lyric: "words" | "stack" | "type";
  /** render cutouts and photos through a low-res canvas */
  pixel: boolean;
  /** raise the stage floor by this share of the height (landscape), for themes that put lyrics underneath */
  lift: number;
};

const T = (family: Family, variant: Variant, fonts: string[], lyric: Theme["lyric"] = "words"): Theme => ({
  family,
  variant,
  fonts,
  lyric,
  pixel: family === "bit",
  lift: family === "bit" ? 0.29 : family === "arena" ? 0.11 : 0,
});

const NEON = ["Kanit:ital,wght@1,700;1,900", "Yellowtail"];
const STRUT = ["Shrikhand"];
const DECO = ["Limelight", "Poiret+One"];
const TWOTONE = ["Big+Shoulders+Stencil+Display:wght@600;900"];
const ARENA = ["Metal+Mania", "Anton"];
const ZINE = ["Rubik+Mono+One", "Special+Elite", "Permanent+Marker", "Abril+Fatface", "Courier+Prime:wght@700"];
const ATOMIC = ["Lobster", "Alfa+Slab+One"];
const BLUENOTE = ["Barlow+Condensed:ital,wght@0,300;0,800;0,900;1,300"];
const TANGO = ["Bodoni+Moda:ital,opsz,wght@0,6..96,500..900;1,6..96,400..900"];
const SALSA = ["Bowlby+One", "Bodoni+Moda:ital,opsz,wght@1,6..96,700..900"];
const BIT = ["Press+Start+2P"];

/** the 19 repertoire styles, plus a few close cousins */
const BY_STYLE: Record<string, Theme> = {
  synthwave: T("neon", "synthwave", NEON),
  "synth-pop": T("neon", "synthwave", NEON),
  "synth pop": T("neon", "synthwave", NEON),
  "italo disco": T("neon", "italo", NEON),
  eurodance: T("neon", "italo", NEON),
  funk: T("strut", "funk", STRUT),
  soul: T("strut", "soul", STRUT),
  "big band": T("deco", "bigband", DECO),
  ska: T("twotone", "ska", TWOTONE),
  "hard rock": T("arena", "hard", ARENA),
  "power ballad": T("arena", "ballad", ARENA),
  punk: T("zine", "punk", ZINE),
  "indie rock": T("zine", "indie", ZINE),
  "rock and roll": T("atomic", "rocknroll", ATOMIC),
  rockabilly: T("atomic", "rocknroll", ATOMIC),
  "surf rock": T("atomic", "surf", ATOMIC),
  "bossa nova": T("bluenote", "bossa", BLUENOTE, "stack"),
  tango: T("milonga", "tango", TANGO),
  salsa: T("milonga", "salsa", SALSA),
  chiptune: T("bit", "chip", BIT, "type"),
};

/** keyword fallback for older tapes and off-repertoire genres; first match wins */
const KEYWORDS: [RegExp, string][] = [
  [/chip|8.?bit|video ?game|game ?boy|\bnes\b|arcade/, "chiptune"],
  [/synthwave|outrun|vaporwave|retrowave|synth.?pop|new wave|electro|city pop|hi.?nrg/, "synthwave"],
  [/italo|euro|\bhouse\b|techno|trance|\brave\b|\bclub\b/, "italo disco"],
  [/power ballad|ballad|soft rock|\baor\b/, "power ballad"],
  [/metal|hard rock|arena|glam|stadium|\bhair\b|grunge|stoner/, "hard rock"],
  [/punk|hardcore|\briot\b|\boi\b/, "punk"],
  [/indie|lo.?fi|garage|shoegaze|\bemo\b|\balt\b|alternative|college|bedroom|post.?rock/, "indie rock"],
  [/\bska\b|two.?tone|2.?tone|rocksteady|reggae|\bdub\b|dancehall/, "ska"],
  [/tango|milonga|flamenco|bolero|fado|cabaret/, "tango"],
  [/salsa|mambo|cumbia|merengue|cha.?cha|latin|son cubano|boogaloo|bachata|rumba|samba de/, "salsa"],
  [/bossa|samba|tropic[aá]lia|mpb|cool jazz|hard bop|bebop|bop\b|jazz/, "bossa nova"],
  [/big band|swing|lounge|crooner|cabaret|vaudeville|ragtime|dixie/, "big band"],
  [/surf|hawaiian|exotica/, "surf rock"],
  [/rockabilly|rock.?n.?roll|rock and roll|doo.?wop|blue.?grass|country|western|honky|folk|americana|skiffle|1950s|'50s|fifties/, "rock and roll"],
  [/funk|disco|boogie|p.?funk|groove/, "funk"],
  [/soul|motown|philly|gospel|r&b|rhythm and blues|northern/, "soul"],
  [/rock/, "hard rock"],
  [/synth|80s|1980s|neon/, "synthwave"],
];

export const FAMILIES: Family[] = ["neon", "strut", "deco", "twotone", "arena", "zine", "atomic", "bluenote", "milonga", "bit"];

/** one representative style per family (and per variant) for the dev override */
const OVERRIDE: Record<string, string> = {
  neon: "synthwave",
  italo: "italo disco",
  strut: "funk",
  funk: "funk",
  soul: "soul",
  deco: "big band",
  "two-tone": "ska",
  twotone: "ska",
  arena: "hard rock",
  hard: "hard rock",
  ballad: "power ballad",
  zine: "punk",
  indie: "indie rock",
  atomic: "rock and roll",
  surf: "surf rock",
  "blue note": "bossa nova",
  "blue-note": "bossa nova",
  bluenote: "bossa nova",
  milonga: "tango",
  salsa: "salsa",
  "8-bit": "chiptune",
  "8bit": "chiptune",
  bit: "chiptune",
};

function norm(s: string | undefined | null) {
  return (s ?? "").toLowerCase().replace(/[_+]/g, " ").trim();
}

function byKeyword(s: string): Theme | null {
  for (const [re, style] of KEYWORDS) if (re.test(s)) return BY_STYLE[style];
  return null;
}

/** dev only: `?theme=<family|style>` previews any theme on any tape */
function override(): Theme | null {
  if (!import.meta.env.DEV) return null;
  const q = norm(new URLSearchParams(location.search).get("theme"));
  if (!q) return null;
  return BY_STYLE[q] ?? BY_STYLE[OVERRIDE[q] ?? ""] ?? null;
}

export function resolveTheme(tape: Tape): Theme {
  const o = override();
  if (o) return o;
  const style = norm(tape.style);
  if (BY_STYLE[style]) return BY_STYLE[style];
  return (style && byKeyword(style)) || byKeyword(norm(tape.genre)) || BY_STYLE.synthwave;
}

/** inject the active theme's Google Fonts once */
export function useThemeFonts(theme: Theme) {
  useEffect(() => {
    const id = `vfont-${theme.family}-${theme.variant}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${theme.fonts.map((f) => `family=${f}`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, [theme]);
}
