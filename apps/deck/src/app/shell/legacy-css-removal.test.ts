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

test("shared ui does not expose domain-specific primitives", () => {
  assert.equal(existsSync(join(deckRoot, "src/shared/ui/primitives.tsx")), false);
});

test("shared ui does not import Tiller domain types", () => {
  const sharedUiSource = readDeck("src/shared/ui/index.ts");

  assert.doesNotMatch(sharedUiSource, /@tiller\/shared/);
  assert.doesNotMatch(sharedUiSource, /primitives/);
});

test("shell styles do not own feature page styles", () => {
  const shellStyles = readDeck("src/app/shell/styles.css");

  assert.doesNotMatch(shellStyles, /\.landing-/);
  assert.doesNotMatch(shellStyles, /\.toast-/);
  assert.doesNotMatch(shellStyles, /view-overview/);
});

test("mission css aggregator is removed", () => {
  assert.equal(existsSync(join(deckRoot, "src/features/mission/styles.css")), false);
});

test("migration inventory documents final retained css surface", () => {
  const inventory = readRepo("docs/tailwind-migration-inventory.md");

  assert.match(inventory, /CSS files: 4/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/styles\.css/);
  assert.match(inventory, /apps\/deck\/src\/app\/shell\/tokens\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/overview\/ui\/page\.css/);
  assert.match(inventory, /apps\/deck\/src\/features\/toast\/styles\.css/);
  assert.doesNotMatch(inventory, /apps\/deck\/src\/features\/mission\/styles\.css/);
});
