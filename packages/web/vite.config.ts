import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@reddit-saved\/core$/, replacement: resolve(__dirname, "../core/src/index.ts") },
      {
        find: /^@reddit-saved\/core\/(.*)$/,
        replacement: resolve(__dirname, "../core/src/$1"),
      },
      { find: /^@\//, replacement: `${resolve(__dirname, "src")}/` },
    ],
  },
  server: {
    port: 3000,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
