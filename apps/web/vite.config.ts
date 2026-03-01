import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { z } from "zod";

const FarfieldApiOriginEnvSchema = z.object({
  FARFIELD_API_ORIGIN: z.string().url().optional(),
  REACT_COMPILER: z.enum(["0", "1", "true", "false"]).optional(),
  REACT_PROFILING: z.enum(["0", "1", "true", "false"]).optional(),
});
const parsedEnv = FarfieldApiOriginEnvSchema.safeParse({
  FARFIELD_API_ORIGIN: process.env["FARFIELD_API_ORIGIN"],
  REACT_COMPILER: process.env["REACT_COMPILER"],
  REACT_PROFILING: process.env["REACT_PROFILING"],
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
const reactCompilerEnabled =
  parsedEnv.data.REACT_COMPILER === "1" ||
  parsedEnv.data.REACT_COMPILER === "true";
const reactProfilingEnabled =
  parsedEnv.data.REACT_PROFILING === "1" ||
  parsedEnv.data.REACT_PROFILING === "true";

const resolveAlias: Record<string, string> = {
  "@": path.resolve(__dirname, "./src"),
};

if (reactProfilingEnabled) {
  resolveAlias["react-dom/client"] = "react-dom/profiling";
}

export default defineConfig({
  plugins: [
    react(
      reactCompilerEnabled
        ? {
            babel: {
              plugins: ["babel-plugin-react-compiler"],
            },
          }
        : undefined,
    ),
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
    alias: resolveAlias,
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
