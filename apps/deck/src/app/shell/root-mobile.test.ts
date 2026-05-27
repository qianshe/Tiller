import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootSource = readFileSync(resolve(currentDir, "root.tsx"), "utf8");

test("mobile diff selection moves the mission worktree to the display pane", () => {
  assert.match(rootSource, /function openDiffDetail\(path: string\)/);
  assert.match(rootSource, /panelPages\.openDiffFile\(path\);\s*layout\.setSelectedMissionMobilePane\("display"\);/s);
});
