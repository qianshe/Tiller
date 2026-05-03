import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createPublishPackageManifest } from "./package-manifest.mjs";

const root = resolve(import.meta.dirname, "../../..");
const helmRoot = resolve(import.meta.dirname, "..");
const deckDist = resolve(root, "apps/deck/dist");
const packagedDeck = resolve(helmRoot, "dist/deck");
const publishRoot = resolve(helmRoot, "dist-package");
const publishDist = resolve(publishRoot, "dist");
const packageJsonPath = resolve(helmRoot, "package.json");

const TOP_LEVEL_DOC_FILES = [
  "README.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
];

run("pnpm", ["--filter", "@tiller/deck", "build"], {
  cwd: root,
  env: { ...process.env, VITE_TILLER_EMBEDDED_HELM: "true" },
});

run("pnpm", ["exec", "tsup"], { cwd: helmRoot, env: process.env });

rmSync(packagedDeck, { recursive: true, force: true });
cpSync(deckDist, packagedDeck, { recursive: true });

writePublishPackage();

function writePublishPackage() {
  const workspaceManifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const publishManifest = createPublishPackageManifest(workspaceManifest);
  rmSync(publishRoot, { recursive: true, force: true });
  mkdirSync(publishRoot, { recursive: true });
  cpSync(resolve(helmRoot, "dist"), publishDist, { recursive: true });
  writeFileSync(resolve(publishRoot, "package.json"), `${JSON.stringify(publishManifest, null, 2)}\n`, "utf8");
  for (const fileName of TOP_LEVEL_DOC_FILES) {
    const sourcePath = resolve(root, fileName);
    if (existsSync(sourcePath)) {
      cpSync(sourcePath, resolve(publishRoot, fileName));
    }
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
