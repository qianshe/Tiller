import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const cwd = process.cwd();
const deckRoot = existsSync(join(cwd, "src", "app")) ? cwd : join(cwd, "apps", "deck");

function readDeck(relativePath: string): string {
  return readFileSync(join(deckRoot, relativePath), "utf8");
}

test("mobile shell exposes a document scroll affordance for browser chrome collapse", () => {
  const root = readDeck("src/app/shell/root.tsx");
  const styles = readDeck("src/app/shell/styles.css");

  assert.match(root, /mobile-addressbar-scroll-shell/);
  assert.match(root, /tryCollapseMobileAddressBar/);
  assert.match(styles, /\.mobile-addressbar-scroll-shell/);
  assert.match(styles, /min-height:\s*calc\(100dvh \+ 80px\)/);
  assert.match(styles, /position:\s*sticky/);
});
