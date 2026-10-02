import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        // The caption font lives with the renderer. Vite allow-lists are
        // directory prefixes, so grant the fonts directory, not the file.
        fileURLToPath(new URL("../engine/studio/fonts", import.meta.url)),
      ],
    },
    proxy: {
      "/api": process.env.SHORTFORGE_ENGINE_URL || "http://127.0.0.1:8787",
    },
  },
});
