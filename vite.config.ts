import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bundle is served by `aip server --inspector` under /inspector, so the base
// is fixed. In development the same four API prefixes are proxied to a running
// server (AIP_SERVER, default http://localhost:8000), which keeps the app
// same-origin in both cases and the server free of CORS.
const server = process.env.AIP_SERVER ?? "http://localhost:8000";
const api = ["/catalog", "/procedures", "/runs", "/governance"];

export default defineConfig({
  base: "/inspector/",
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: Object.fromEntries(api.map((p) => [p, { target: server, changeOrigin: true }])),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
