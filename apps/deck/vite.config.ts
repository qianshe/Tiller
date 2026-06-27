import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export function createNoStoreDevServerPlugin(): Plugin {
  return {
    name: "tiller-dev-no-store-cache",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        delete req.headers["if-none-match"];
        delete req.headers["if-modified-since"];
        res.setHeader("Cache-Control", "no-store");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [createNoStoreDevServerPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: true,
        manualChunks(id) {
          if (id.includes("/src/features/mission/")) return "mission";
          if (id.includes("/src/features/helm-connection/")) return "helm-connection";
          if (id.includes("/src/features/server-events/")) return "server-events";
          if (id.includes("/src/store/")) return "deck-store";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    headers: {
      "Cache-Control": "no-store",
    },
    port: 5173,
  },
});
