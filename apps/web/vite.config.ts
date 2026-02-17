import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
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
