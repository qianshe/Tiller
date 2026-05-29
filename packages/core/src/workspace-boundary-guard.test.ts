import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    return [path];
  });
}

function sharedTypeImports(source: string) {
  const imports: string[] = [];
  const pattern = /import\s+type\s+\{(?<specifiers>[^}]*?)\}\s+from\s+"@tiller\/shared";/g;
  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers ?? "";
    imports.push(
      ...specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean),
    );
  }
  return imports;
}

test("ACP adapter sources use explicit runtime provider config names", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const adapterRoot = join(repoRoot, "packages/acp-runtime/src/adapters");
  const violations: string[] = [];

  for (const file of listSourceFiles(adapterRoot)) {
    if (sharedTypeImports(readFileSync(file, "utf8")).includes("AcpAgentProvider")) {
      violations.push(relative(repoRoot, file).replace(/\\/gu, "/"));
    }
  }

  assert.deepEqual(violations, []);
});
