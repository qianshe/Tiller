import assert from "node:assert/strict";
import test from "node:test";
import { mapPromptContentToSdkBlocks, mapSdkPermissionRequest } from "./sdk-helpers.js";

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
  assert.equal(mapped.request.toolCallId, "tool-1");
});

test("mapSdkPermissionRequest falls back to localized labels when SDK label is empty", () => {
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
        { optionId: "allow-once", name: "", kind: "allow_once" },
        { optionId: "deny-once", name: "   ", kind: "reject_once" },
      ],
    },
    "permission-empty-label",
    "D:/myProject/tools/Tiller",
  );

  assert.deepEqual(mapped.request.options, [
    { decision: "allow", label: "本次允许" },
    { decision: "deny", label: "拒绝" },
  ]);
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
    { decision: "allow", label: "Allow once" },
    { decision: "allow_always", label: "Always allow" },
    { decision: "deny", label: "Deny" },
  ]);
  assert.equal(mapped.optionIds.allow_always, "allow-global-1");
  assert.equal(mapped.optionIds.allow, "allow-once");
  assert.equal(mapped.optionIds.deny, "deny-once");
});

test("mapPromptContentToSdkBlocks rejects reference-only images before provider send", () => {
  assert.throws(
    () => mapPromptContentToSdkBlocks([
      {
        type: "image",
        mimeType: "image/png",
        uri: "/api/sessions/session-1/attachments/attachment-1",
        attachmentId: "attachment-1",
      },
    ]),
    /Cannot send reference-only image content to ACP provider/u,
  );
});
