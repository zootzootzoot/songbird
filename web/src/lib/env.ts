/**
 * Where things live.
 *
 * - BASE: the static site root (Vite `base`, e.g. "/" or "/songbird/" on Pages).
 *   Bundled and public assets, the static shelf tapes, live.json.
 * - API: the GPU server. Read from `${BASE}live.json` ({ "api": "https://..." })
 *   at startup; a missing file means same origin ("", the Vite proxy in dev),
 *   an empty api means the studio is closed. Then pinged at /api/health.
 */

/** `?render=1`: the server's recorder is filming this page for the shareable MP4 (no audio, no controls) */
export const RENDER = typeof location !== "undefined" && new URLSearchParams(location.search).has("render");

export const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

let API = "";
let OFFLINE = false;

/** a public / static asset path ("samples/x.jpg" or "/samples/x.jpg") under the site base */
export function asset(path: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return BASE + path.replace(/^\//, "");
}

export function apiUrl(path: string): string {
  return `${API}${path}`;
}

export function apiBase() {
  return API;
}

export function studioClosedByConfig() {
  return OFFLINE;
}

/** prefix a root-relative media URL from the server ("/tapes/...") with the api origin */
export function media(url: string | null): string | null {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return url.startsWith("/") ? `${API}${url}` : url;
}

/** prefix a root-relative URL from a static tape.json with the site base */
export function staticMedia(url: string | null): string | null {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return url.startsWith("/") ? asset(url) : url;
}

export async function loadLiveConfig(): Promise<void> {
  try {
    const res = await fetch(asset("live.json"), { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
      API = "";
      return;
    }
    const body = (await res.json()) as { api?: string | null };
    const api = (body.api ?? "").trim().replace(/\/+$/, "");
    if (!api) {
      OFFLINE = true;
      API = "";
      return;
    }
    API = api;
  } catch {
    API = "";
  }
}
