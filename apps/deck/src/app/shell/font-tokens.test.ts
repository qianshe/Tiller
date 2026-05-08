import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(currentDir, "../..");

function listCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listCssFiles(path);
    }
    return extname(path) === ".css" ? [path] : [];
  });
}

test("feature CSS uses shared font tokens", () => {
  const offenders: string[] = [];

  for (const file of listCssFiles(srcRoot)) {
    const css = readFileSync(file, "utf8");
    for (const match of css.matchAll(/font-family:\s*([^;]+);/g)) {
      const value = (match[1] ?? "").replace(/\s+/g, " ").trim();
      if (value !== "var(--font-sans)" && value !== "var(--font-mono)" && value !== "inherit") {
        offenders.push(`${file}: ${value}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
