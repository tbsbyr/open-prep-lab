import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the build works from any static host, including a GitHub
  // Pages project subpath (there is no client-side router to break).
  base: "./",
  plugins: [react()],
  server: {
    // The PORT env var lets external tools (e.g. preview harnesses) assign a port.
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: "node",
  },
});
