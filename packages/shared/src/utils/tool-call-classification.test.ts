import assert from "node:assert/strict";
import test from "node:test";
import { resolveMergedAgentToolCallKind } from "./tool-call-classification.js";

test("resolveMergedAgentToolCallKind repairs a shell placeholder with structured search evidence", () => {
  assert.equal(
    resolveMergedAgentToolCallKind(
      { kind: "shell" },
      {
        kind: "search",
        input: JSON.stringify({ pattern: "tool-title", glob: "**/*.ts" }),
      },
    ),
    "search",
  );
});

test("resolveMergedAgentToolCallKind keeps shell classification without native search evidence", () => {
  assert.equal(
    resolveMergedAgentToolCallKind(
      { kind: "shell" },
      {
        kind: "search",
        input: JSON.stringify({ command: "grep tool-title -R apps" }),
      },
    ),
    "shell",
  );
});

test("resolveMergedAgentToolCallKind preserves a later subagent classification", () => {
  assert.equal(
    resolveMergedAgentToolCallKind(
      { kind: "tool" },
      { kind: "subagent" },
    ),
    "subagent",
  );
});
