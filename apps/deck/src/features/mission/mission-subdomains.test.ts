import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const missionRoot = fileURLToPath(new URL(".", import.meta.url));

const expectedSubdomains = [
  "workspace",
  "composer",
  "conversation",
  "display",
  "inspector",
  "navigation",
] as const;

test("mission feature exposes documented subdomain entrypoints", () => {
  for (const subdomain of expectedSubdomains) {
    const indexPath = join(missionRoot, subdomain, "index.ts");
    assert.equal(existsSync(indexPath), true, `${subdomain}/index.ts should exist`);
  }
});

test("mission root re-exports subdomain public APIs", () => {
  const indexSource = readFileSync(join(missionRoot, "index.ts"), "utf8");

  for (const subdomain of expectedSubdomains) {
    assert.match(indexSource, new RegExp(`export \\* from "\\./${subdomain}";`));
  }
});
