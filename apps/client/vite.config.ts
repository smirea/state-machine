import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  cacheDir: "../../.cache/vite-client",
  server: {
    port: 5173,
    strictPort: false,
  },
});
