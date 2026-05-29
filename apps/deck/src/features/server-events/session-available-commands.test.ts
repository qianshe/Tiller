import assert from "node:assert/strict";
import test from "node:test";
import { deriveAvailableCommandMapsFromSessions } from "./session-available-commands";

test("deriveAvailableCommandMapsFromSessions indexes commands by session and agent", () => {
  const command = { name: "build", kind: "workflow" };
  const maps = deriveAvailableCommandMapsFromSessions([
    { id: "s1", agentId: "codex", availableCommands: [command] },
    { id: "s2", agentId: "empty", availableCommands: [] },
  ] as any);

  assert.deepEqual(maps, {
    bySession: { s1: [command] },
    byAgent: { codex: [command] },
  });
});
