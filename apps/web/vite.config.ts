import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Farfield",
        short_name: "Farfield",
        start_url: "/",
        display: "standalone",
        theme_color: "#0a0a0b",
        background_color: "#0a0a0b"
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 4312,
    proxy: {
      "/api": "http://127.0.0.1:4311",
      "/events": "http://127.0.0.1:4311"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: []
  }
});
