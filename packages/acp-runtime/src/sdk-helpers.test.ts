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
    { decision: "allow", label: "Allow once" },
    { decision: "allow_session", label: "Allow for this session" },
    { decision: "allow_always", label: "Always allow" },
    { decision: "deny", label: "Deny" },
  ]);
  assert.equal(mapped.optionIds.allow, "allow-once");
  assert.equal(mapped.optionIds.allow_session, "allow-session");
  assert.equal(mapped.optionIds.allow_always, "allow-always");
  assert.equal(mapped.optionIds.deny, "deny-once");
});
