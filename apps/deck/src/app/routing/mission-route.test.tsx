import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const routePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "mission-route.tsx",
);

test("renderMissionRoute forwards diff directory collapse state to the mission workspace", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /collapsedMissionDiffDirectories,\n\s+missionInspectorPaneStyle,/);
  assert.match(
    source,
    /collapsedMissionDiffDirectories=\{collapsedMissionDiffDirectories\}/,
  );
});
