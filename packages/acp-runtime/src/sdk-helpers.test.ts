import assert from "node:assert/strict";
import test from "node:test";
import { mapSdkPermissionRequest } from "./sdk-helpers.js";

test("mapSdkPermissionRequest exposes scoped permission options", () => {
  const mapped = mapSdkPermissionRequest(
    {
      sessionId: "s1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Approve MCP tool call",
        kind: "other",
        status: "pending",
        rawInput: {
          server_name: "mcp_router",
          request: { name: "read_file" },
        },
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-session", name: "Allow for this session", kind: "allow_always" },
        { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
        { optionId: "deny-once", name: "Deny", kind: "reject_once" },
      ],
    },
    "permission-1",
    "D:/myProject/tools/Tiller",
  );

  assert.deepEqual(mapped.request.options, [
    { decision: "allow", label: "本次允许" },
    { decision: "allow_session", label: "本会话允许" },
    { decision: "allow_always", label: "全局允许" },
    { decision: "deny", label: "拒绝" },
  ]);
  assert.equal(mapped.optionIds.allow, "allow-once");
  assert.equal(mapped.optionIds.allow_session, "allow-session");
  assert.equal(mapped.optionIds.allow_always, "allow-always");
  assert.equal(mapped.optionIds.deny, "deny-once");
});


test("mapSdkPermissionRequest deduplicates equivalent global allow options", () => {
  const mapped = mapSdkPermissionRequest(
    {
      sessionId: "s1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Approve MCP tool call",
        kind: "other",
        status: "pending",
        rawInput: { server_name: "mcp_router", request: { name: "zhi" } },
      },
      options: [
        { optionId: "allow-global-1", name: "Always allow", kind: "allow_always" },
        { optionId: "allow-global-2", name: "Always allow", kind: "allow_always" },
        { optionId: "allow-global-3", name: "全局允许", kind: "allow_always" },
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "deny-once", name: "Deny", kind: "reject_once" },
      ],
    },
    "permission-duplicate-global",
    "D:/myProject/tools/Tiller",
  );

  assert.deepEqual(mapped.request.options, [
    { decision: "allow", label: "本次允许" },
    { decision: "allow_always", label: "全局允许" },
    { decision: "deny", label: "拒绝" },
  ]);
  assert.equal(mapped.optionIds.allow_always, "allow-global-1");
  assert.equal(mapped.optionIds.allow, "allow-once");
  assert.equal(mapped.optionIds.deny, "deny-once");
});
