import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/app/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["node:sqlite", "@agentclientprotocol/sdk", "qrcode-terminal", "ws"],
  noExternal: ["@tiller/shared", "@tiller/sync-protocol", "@tiller/agent-registry", "@tiller/acp-runtime"],
});
