import assert from "node:assert/strict";
import test from "node:test";
import { loadProviderAuthoritativeHistory, parseOpenCodeExportHistory } from "./opencode-export.js";

test("parseOpenCodeExportHistory maps message and tool timestamps from OpenCode export", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [{ type: "text", text: "尝试调用个mcp或者skill，我测试下效果" }],
        },
        {
          id: "msg-assistant",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            { type: "text", text: "我来调用工具" },
            {
              id: "prt-tool",
              type: "tool",
              tool: "mcp-router_get_current_config",
              callID: "call-1",
              state: {
                status: "completed",
                input: {},
                output: "ok",
                title: "",
                time: { start: 1777543150384, end: 1777543150482 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user",
      role: "user",
      text: "尝试调用个mcp或者skill，我测试下效果",
      timestamp: "2026-04-30T09:58:57.952Z",
    },
    {
      id: "msg-assistant",
      role: "assistant",
      text: "我来调用工具",
      timestamp: "2026-04-30T09:58:57.977Z",
    },
  ]);
  assert.deepEqual(history.toolCalls, [
    {
      id: "call-1",
      commandId: "call-1",
      kind: "tool",
      title: "mcp-router_get_current_config",
      status: "completed",
      input: "{}",
      output: "ok",
      timestamp: "2026-04-30T09:59:10.384Z",
      updatedAt: "2026-04-30T09:59:10.482Z",
    },
  ]);
});

test("loadProviderAuthoritativeHistory returns null for providers without native export", async () => {
  assert.equal(
    await loadProviderAuthoritativeHistory(
      { id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" },
      "runtime-1",
      "D:/repo",
    ),
    null,
  );
  assert.equal(
    await loadProviderAuthoritativeHistory(
      { id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" },
      "runtime-1",
      "D:/repo",
    ),
    null,
  );
});
