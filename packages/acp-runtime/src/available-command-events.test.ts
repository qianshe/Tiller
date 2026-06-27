import assert from "node:assert/strict";
import test from "node:test";
import { extractAvailableCommands } from "./available-command-events";

test("extractAvailableCommands preserves command kind metadata", () => {
  const commands = extractAvailableCommands("available_commands_update", {
    availableCommands: [
      {
        name: "build",
        description: "Build project",
        kind: "workflow",
        input: { hint: "target" },
        meta: { source: "system", scope_prefix: "project" },
      },
    ],
  });

  assert.deepEqual(commands, [
    {
      name: "build",
      description: "Build project",
      input: { hint: "target" },
      kind: "workflow",
      rawKind: "workflow",
      source: "system",
      scope: "project",
    },
  ]);
});

test("extractAvailableCommands infers user source commands as skills", () => {
  const commands = extractAvailableCommands("available_commands_update", {
    available_commands: [
      { name: "review", description: "Review code (user)" },
      { name: "builtin", description: "[builtin] Internal" },
    ],
  });

  assert.deepEqual(commands?.map((command) => ({ name: command.name, kind: command.kind, source: command.source })), [
    { name: "review", kind: "skill", source: "user" },
    { name: "builtin", kind: "builtin", source: undefined },
  ]);
});

test("extractAvailableCommands ignores unrelated updates", () => {
  assert.equal(extractAvailableCommands("agent_message_chunk", { availableCommands: [{ name: "x" }] }), null);
});
