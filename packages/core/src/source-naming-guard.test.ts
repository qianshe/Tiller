import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  "dist",
  "dist-package",
  "node_modules",
  "output",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);

const ALLOWED_STUTTER_FILES = new Map<string, string>([
  [
    "apps/deck/src/features/mission/composer/composer.tsx",
    "component root kept until the composer component is split from its folder entry",
  ],
  [
    "apps/deck/src/features/mission/inspector/inspector.tsx",
    "component root kept until the inspector component is split from its folder entry",
  ],
  [
    "apps/deck/src/features/mission/workspace/workspace.tsx",
    "component root kept until the workspace controller split replaces the folder entry",
  ],
]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (EXCLUDED_DIRECTORIES.has(entry)) {
      return [];
    }
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listSourceFiles(path);
    }
    if (!SOURCE_EXTENSIONS.has(extname(path)) || /\.test\.[^.]+$/u.test(path)) {
      return [];
    }
    return [path];
  });
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/");
}

function sourceNamingViolations(repoRoot: string): string[] {
  const sourceRoots = ["apps", "packages"].map((entry) => join(repoRoot, entry));
  const violations: string[] = [];

  for (const file of sourceRoots.flatMap(listSourceFiles)) {
    const relativePath = normalizePath(relative(repoRoot, file));
    if (ALLOWED_STUTTER_FILES.has(relativePath)) {
      continue;
    }
    const parent = basename(dirname(file));
    const fileName = basename(file, extname(file));
    const repeatsParentName =
      fileName === parent ||
      fileName.startsWith(`${parent}-`) ||
      fileName.includes(`-${parent}-`);

    if (repeatsParentName) {
      violations.push(relativePath);
    }
  }

  return violations.sort();
}

test("source files avoid repeating their immediate folder name", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

  assert.deepEqual(sourceNamingViolations(repoRoot), []);
});
