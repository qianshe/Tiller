import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: "src/app/main.ts",
    updater: "src/updates/updater.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  define: {
    __TILLER_VERSION__: JSON.stringify(packageJson.version),
  },
  external: ["node:sqlite", "@agentclientprotocol/sdk", "qrcode-terminal", "ws", "yaml"],
  noExternal: [/^@tiller\//u],
});
