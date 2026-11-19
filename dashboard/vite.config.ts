import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { main: "index.html", oauth: "oauth.html" } },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com; font-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
    proxy: {
      "/api": process.env.SHORTFORGE_ENGINE_URL || "http://127.0.0.1:8787",
    },
  },
});
