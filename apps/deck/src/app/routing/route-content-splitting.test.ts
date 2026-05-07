import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const routeContentPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "route-content.tsx",
);

test("top-level route content uses lazy page modules", () => {
  const source = readFileSync(routeContentPath, "utf8");

  assert.match(source, /lazy\(\(\) =>\s+import\("\.\.\/\.\.\/features\/overview\/ui\/page"\)/);
  assert.match(source, /lazy\(\(\) =>\s+import\("\.\.\/\.\.\/features\/agents\/ui\/page"\)/);
  assert.match(source, /lazy\(\(\) =>\s+import\("\.\.\/\.\.\/features\/settings\/ui\/page"\)/);
  assert.match(source, /lazy\(\(\) =>\s+import\("\.\/mission-route"\)/);
});
