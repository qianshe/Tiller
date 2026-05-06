import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePermissionActionLabel,
  resolvePermissionCommandDisplay,
} from "./permission-drawer.js";

const drawerCopy = {
  permissionRequest: "权限请求",
  allowOnce: "同意",
  deny: "取消",
};

test("permission command display uses MCP server and tool name instead of raw approval JSON", () => {
  const rawInput = JSON.stringify({
    server_name: "mcp_router",
    request: {
      name: "read_file",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
      },
    },
  });

  const display = resolvePermissionCommandDisplay(
    `Approve MCP tool call :: ${rawInput}`,
  );

  assert.equal(display.title, "MCP · mcp_router/read_file");
  assert.equal(display.detail, null);
});

test("permission command display falls back to MCP server name when tool name is unavailable", () => {
  const rawInput = JSON.stringify({
    server_name: "mcp_router",
    request: {
      _meta: {
        codex_approval_kind: "mcp_tool_call",
      },
    },
  });

  const display = resolvePermissionCommandDisplay(
    `Approve MCP tool call :: ${rawInput}`,
  );

  assert.equal(display.title, "MCP · mcp_router");
  assert.equal(display.detail, null);
});

test("permission command display uses pending tool title when approval payload only has MCP server", () => {
  const rawInput = JSON.stringify({
    server_name: "mcp_router",
    request: {
      _meta: {
        codex_approval_kind: "mcp_tool_call",
      },
    },
  });

  const display = resolvePermissionCommandDisplay(
    `Approve MCP tool call :: ${rawInput}`,
    "Tool: mcp_router/new_page",
  );

  assert.equal(display.title, "MCP · mcp_router/new_page");
  assert.equal(display.detail, null);
});

test("permission action labels localize scoped approval options", () => {
  assert.equal(
    resolvePermissionActionLabel({ decision: "allow", label: "Allow once" }, drawerCopy),
    "同意",
  );
  assert.equal(
    resolvePermissionActionLabel(
      { decision: "allow_session", label: "Allow for this session" },
      drawerCopy,
    ),
    "本会话允许",
  );
  assert.equal(
    resolvePermissionActionLabel(
      { decision: "allow_always", label: "Always allow" },
      drawerCopy,
    ),
    "全局允许",
  );
  assert.equal(
    resolvePermissionActionLabel({ decision: "deny", label: "Deny" }, drawerCopy),
    "取消",
  );
});

test("permission command display promotes concrete shell commands", () => {
  const display = resolvePermissionCommandDisplay(
    'Run shell command :: {"command":["pnpm","--dir","apps/deck","test"]}',
  );

  assert.equal(display.title, "pnpm --dir apps/deck test");
  assert.equal(display.detail, null);
});
