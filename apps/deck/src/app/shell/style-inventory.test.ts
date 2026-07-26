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

test("style inventory script documents final CSS entry points", () => {
  execFileSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  assert.equal(existsSync(inventoryPath), true);
  const inventory = readFileSync(inventoryPath, "utf8");

  assert.match(inventory, /- CSS files: 12/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/styles\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/brand\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/semantic\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/light\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/dark\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/harbor\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/voyage\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/chart\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\/themes\/system\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/overview\/ui\/page\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/toast\/styles\.css/);
  assert.doesNotMatch(inventory, /apps\/deck\/src\/features\/mission\/styles\.css/);
});
