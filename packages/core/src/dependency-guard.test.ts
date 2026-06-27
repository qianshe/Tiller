import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FORBIDDEN_IMPORTS = [
  "@agentclientprotocol/sdk",
  "ws",
  "react",
  "node:fs",
  "node:child_process",
  "apps/",
  "@tiller/acp-runtime",
  "@tiller/agent-registry",
  "@tiller/sync-protocol",
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    return [path];
  });
}

test("core source does not import runtime, transport, app, or platform APIs", () => {
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const violations: string[] = [];

  for (const file of listSourceFiles(sourceRoot)) {
    const text = readFileSync(file, "utf8");
    for (const forbidden of FORBIDDEN_IMPORTS) {
      if (text.includes(`from \"${forbidden}`) || text.includes(`from '${forbidden}`)) {
        violations.push(`${file}: ${forbidden}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
