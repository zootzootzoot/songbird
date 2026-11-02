import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = "http://127.0.0.1:8787";
// "/" by default; "/songbird/" for GitHub Pages: SONGBIRD_BASE=/songbird/ npm run build
const base = process.env.SONGBIRD_BASE || "/";

// static shelf tapes live in public/tapes; only proxy /tapes paths that aren't there
const publicDir = path.resolve(__dirname, "public");
const tapesProxy = {
  target: SERVER,
  changeOrigin: true,
  bypass(req: { url?: string }) {
    const url = (req.url ?? "").split("?")[0];
    const rel = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
    if (fs.existsSync(path.join(publicDir, rel))) return req.url;
    return undefined;
  },
};

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/tapes": tapesProxy,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/tapes": tapesProxy,
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
});
