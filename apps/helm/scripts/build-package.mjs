import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const helmRoot = resolve(import.meta.dirname, "..");
const deckDist = resolve(root, "apps/deck/dist");
const packagedDeck = resolve(helmRoot, "dist/deck");

run("pnpm", ["--filter", "@tiller/deck", "build"], {
  cwd: root,
  env: { ...process.env, VITE_TILLER_EMBEDDED_HELM: "true" },
});

run("pnpm", ["exec", "tsup"], { cwd: helmRoot, env: process.env });

rmSync(packagedDeck, { recursive: true, force: true });
cpSync(deckDist, packagedDeck, { recursive: true });

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
