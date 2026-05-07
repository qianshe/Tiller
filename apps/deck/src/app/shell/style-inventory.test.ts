import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deckRoot = resolve(currentDir, "../../..");
const repoRoot = resolve(deckRoot, "../..");
const scriptPath = resolve(deckRoot, "scripts/style-inventory.mjs");
const inventoryPath = resolve(repoRoot, "docs/tailwind-migration-inventory.md");

test("style inventory script documents known CSS entry points", () => {
  execFileSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  assert.equal(existsSync(inventoryPath), true);
  const inventory = readFileSync(inventoryPath, "utf8");

  assert.match(inventory, /- CSS files: \d+/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/styles\.css/);
  assert.doesNotMatch(inventory, /apps\/deck\/src\/features\/settings\/styles\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/agents\/styles\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/mission\/styles\.css/);
});
