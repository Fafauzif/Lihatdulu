import { defineConfig } from "vite";

// The scan API runs as a separate local process (`npm run scan:api`). In dev,
// Vite serves the app and proxies /api so the browser keeps one origin.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
