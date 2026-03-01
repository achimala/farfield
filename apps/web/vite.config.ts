import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { z } from "zod";

const FarfieldApiOriginEnvSchema = z.object({
  FARFIELD_API_ORIGIN: z.string().url().optional(),
});
const parsedEnv = FarfieldApiOriginEnvSchema.safeParse({
  FARFIELD_API_ORIGIN: process.env["FARFIELD_API_ORIGIN"],
});
if (!parsedEnv.success) {
  throw new Error(
    `Invalid FARFIELD_API_ORIGIN: ${parsedEnv.error.issues
      .map((issue) => issue.message)
      .join("; ")}`,
  );
}
const apiOrigin =
  parsedEnv.data.FARFIELD_API_ORIGIN ?? "http://127.0.0.1:4311";

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
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 4312,
    proxy: {
      "/api": apiOrigin,
      "/events": apiOrigin,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4312,
    proxy: {
      "/api": apiOrigin,
      "/events": apiOrigin,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [],
  },
});
