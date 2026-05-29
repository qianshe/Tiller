import assert from "node:assert/strict";
import test from "node:test";
import { extractCommandChunk, extractPermissionRequest } from "./command-events";

test("extractPermissionRequest maps explicit permission updates", () => {
  const request = extractPermissionRequest("sess_perm", "permission_request", {
    permissionId: "perm_1",
    command: "pnpm test",
    reason: "Run tests",
    cwd: "D:/myProject/tools/Tiller",
  });

  assert.deepEqual(request, {
    id: "perm_1",
    command: "pnpm test",
    reason: "Run tests",
    cwd: "D:/myProject/tools/Tiller",
  });
});

test("extractPermissionRequest reads nested permission payloads", () => {
  const request = extractPermissionRequest("sess_perm_nested", "permission_required", {
    id: "perm_nested",
    permission: {
      command: "git status",
      reason: "Inspect workspace",
      cwd: "D:/repo",
    },
  });

  assert.deepEqual(request, {
    id: "perm_nested",
    command: "git status",
    reason: "Inspect workspace",
    cwd: "D:/repo",
  });
});

test("extractCommandChunk maps command output updates", () => {
  const chunk = extractCommandChunk("sess_cmd", "command_output", {
    id: "cmd_chunk_1",
    commandId: "cmd_1",
    output: "hello",
    stream: "stderr",
  });

  assert.ok(chunk);
  assert.equal(chunk.id, "cmd_chunk_1");
  assert.equal(chunk.commandId, "cmd_1");
  assert.equal(chunk.text, "hello");
  assert.equal(chunk.stream, "stderr");
  assert.match(chunk.timestamp, /\d{4}-\d{2}-\d{2}T/u);
});

test("extractCommandChunk reads text content fallback", () => {
  const chunk = extractCommandChunk("sess_cmd_text", "command_output", {
    id: "cmd_chunk_text",
    content: { type: "text", text: "from content" },
  });

  assert.ok(chunk);
  assert.equal(chunk.text, "from content");
  assert.equal(chunk.stream, "stdout");
});
