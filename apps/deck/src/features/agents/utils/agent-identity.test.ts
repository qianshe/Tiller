import assert from "node:assert/strict";
import test from "node:test";
import { createProjectId, slugify, splitArgs } from "./agent-identity.js";

test("slugify creates kebab ids and falls back for empty values", () => {
  assert.equal(slugify(" Open Code ACP! "), "open-code-acp");
  assert.equal(slugify("!!!"), "custom-agent");
});

test("createProjectId skips existing numeric ids and holes", () => {
  assert.equal(
    createProjectId([
      { id: "project-1", name: "One", helmId: "h1" },
      { id: "project-3", name: "Three", helmId: "h1" },
      { id: "custom", name: "Custom", helmId: "h1" },
    ]),
    "project-4",
  );
});

test("splitArgs trims whitespace and drops empty entries", () => {
  assert.deepEqual(splitArgs(" acp   --pure  "), ["acp", "--pure"]);
});
