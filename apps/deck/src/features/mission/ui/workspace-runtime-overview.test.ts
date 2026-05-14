import assert from "node:assert/strict";
import test from "node:test";
import { dedupeRuntimeOverviewItems } from "./workspace-runtime-overview";

test("dedupeRuntimeOverviewItems merges ACP cards for the same agent and cwd", () => {
  const items = dedupeRuntimeOverviewItems([
    {
      id: "acp:opencode:D:/repo",
      agentId: "opencode",
      cwd: "D:/repo",
      label: "OpenCode",
      status: "已连接",
      runtimeSessionId: "1 个会话",
      model: "cpa-oai/gpt-5.5",
      children: [{ id: "session-1" }],
      canReconnect: true,
    },
    {
      id: "acp:opencode:D:/repo",
      agentId: "opencode",
      cwd: "D:\\repo\\",
      label: "OpenCode",
      status: "已连接",
      runtimeSessionId: "0 个会话",
      children: [],
      canReconnect: true,
    },
    {
      id: "acp:opencode",
      agentId: "opencode",
      cwd: "D:/repo",
      label: "OpenCode",
      status: "未连接",
      runtimeSessionId: "暂无连接",
      canConnect: true,
      canReconnect: false,
    },
  ]);

  assert.equal(items.length, 1);
  const item = items[0] as (typeof items)[number] & { children?: Array<{ id?: string }> };
  assert.ok(item);
  assert.equal(item.id, "acp:opencode:D:/repo");
  assert.equal(item.model, "cpa-oai/gpt-5.5");
  assert.equal(item.status, "已连接");
  assert.equal(item.canReconnect, true);
  assert.equal(item.canConnect, false);
  assert.deepEqual((item as { children?: Array<{ id?: string }> }).children, [{ id: "session-1" }]);
});
