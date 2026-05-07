import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const cwd = process.cwd();
const deckRoot = existsSync(join(cwd, "src", "app")) ? cwd : join(cwd, "apps", "deck");
const repoRoot = existsSync(join(cwd, "docs")) ? cwd : join(deckRoot, "..", "..");

function readDeck(relativePath: string): string {
  return readFileSync(join(deckRoot, relativePath), "utf8");
}

function readRepo(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("deck shell imports only shell-owned css entries", () => {
  const main = readDeck("src/app/shell/main.tsx");
  const cssImports = [...main.matchAll(/import\s+["']([^"']+\.css)["'];/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(cssImports, ["./tokens.css", "./styles.css"]);
});

test("mission css aggregator is removed", () => {
  assert.equal(existsSync(join(deckRoot, "src/features/mission/styles.css")), false);
});

test("migration inventory documents final retained css surface", () => {
  const inventory = readRepo("docs/tailwind-migration-inventory.md");

  assert.match(inventory, /CSS files: 2/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/styles\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\.css/);
  assert.doesNotMatch(inventory, /apps\/deck\/src\/features\/mission\/styles\.css/);
});
