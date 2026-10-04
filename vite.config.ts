import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
  },
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router"] },
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    react(),
    ...(command === "build"
      ? [nitro({ preset: "node_server", output: { dir: "dist" } })]
      : []),
  ],
}));
