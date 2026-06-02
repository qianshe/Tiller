import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { buildAuthoritativeHistoryFromEvents } from "../history-events.js";
import { loadAdapterAuthoritativeHistory } from "../index.js";
import { codexHistoryReader, parseCodexJsonlHistory } from "./history.js";

const codexHistoryContext = {
  provider: {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  },
  runtimeSessionId: "rollout-test",
  cwd: "D:/repo",
};

test("parseCodexJsonlHistory preserves messages reasoning tools and images in order", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-05-31T06:38:57.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "看图修复" },
            { type: "input_image", image_url: "data:image/png;base64,codex-png" },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:38:58.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [],
          content: [{ type: "reasoning_text", text: "先检查历史组装" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:38:59.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell_command",
          namespace: "functions",
          arguments: "{\"command\":\"pnpm test\"}",
          call_id: "call-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:39:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "ok",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:39:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "修好了" }],
          phase: "final",
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "codex:message:0",
      role: "user",
      text: "看图修复",
      timestamp: "2026-05-31T06:38:57.000Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "codex-png",
          mimeType: "image/png",
          name: "codex:message:0-image-1.png",
        },
      ],
    },
    {
      id: "codex:message:4",
      role: "assistant",
      text: "修好了",
      timestamp: "2026-05-31T06:39:01.000Z",
      timelineSequence: 4,
    },
  ]);
  assert.deepEqual(history.toolCalls, [
    {
      id: "codex:thinking:1",
      commandId: "codex:thinking:1",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "先检查历史组装",
      timestamp: "2026-05-31T06:38:58.000Z",
      updatedAt: "2026-05-31T06:38:58.000Z",
      timelineSequence: 2,
    },
    {
      id: "call-1",
      commandId: "call-1",
      kind: "shell",
      title: "functions.shell_command",
      status: "completed",
      input: "{\"command\":\"pnpm test\"}",
      output: "ok",
      timestamp: "2026-05-31T06:38:59.000Z",
      updatedAt: "2026-05-31T06:39:00.000Z",
      timelineSequence: 3,
    },
  ]);

  assert.deepEqual(
    buildSessionTimelineFromLegacy(history).map((entry) => entry.kind),
    ["user_message", "assistant_message", "tool_call", "assistant_message"],
  );
});

test("codexHistoryReader.toEvents emits message thinking tool and result events", () => {
  const raw = [
    JSON.stringify({
      timestamp: "2026-05-31T06:38:57.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "检查历史顺序" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-31T06:38:58.000Z",
      type: "response_item",
      payload: {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "先定位来源" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-31T06:38:59.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        namespace: "functions",
        arguments: "{\"command\":\"pnpm test\"}",
        call_id: "call-1",
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-31T06:39:00.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call-1", output: "ok" },
    }),
    JSON.stringify({
      timestamp: "2026-05-31T06:39:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "完成" }],
      },
    }),
  ].join("\n");

  const events = codexHistoryReader.toEvents(raw, codexHistoryContext);

  assert.deepEqual(
    events.map((event) => event.kind),
    ["message", "thinking", "tool_call", "tool_result", "message"],
  );
  assert.deepEqual(
    buildSessionTimelineFromLegacy(buildAuthoritativeHistoryFromEvents(events)).map(
      (entry) => entry.kind,
    ),
    ["user_message", "assistant_message", "tool_call", "assistant_message"],
  );
});

test("parseCodexJsonlHistory classifies spawned agents as subagent tool calls", () => {
  const history = parseCodexJsonlHistory(
    JSON.stringify({
      timestamp: "2026-05-31T06:38:59.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agents_on_csv",
        arguments: "{\"agent\":\"explorer\",\"task\":\"map affected files\"}",
        call_id: "call-subagent",
      },
    }),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [["call-subagent", "subagent", "spawn_agents_on_csv"]],
  );
});

test("parseCodexJsonlHistory preserves image-only user prompts", () => {
  const history = parseCodexJsonlHistory(
    JSON.stringify({
      timestamp: "2026-05-31T06:38:57.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: "data:image/webp;base64,codex-webp" }],
      },
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "codex:message:0",
      role: "user",
      text: "图片 1 张",
      timestamp: "2026-05-31T06:38:57.000Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "codex-webp",
          mimeType: "image/webp",
          name: "codex:message:0-image-1.webp",
        },
      ],
    },
  ]);
});

test("loadAdapterAuthoritativeHistory uses local Codex rollout history", async () => {
  const home = mkdtempSync(join(tmpdir(), "tiller-codex-history-"));
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    const sessionDir = join(home, ".codex", "sessions", "2026", "05", "31");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "rollout-2026-05-31T14-38-56-runtime-1.jsonl"),
      JSON.stringify({
        timestamp: "2026-05-31T06:38:57.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "加载 Codex 历史" }],
        },
      }),
      "utf8",
    );

    const history = await loadAdapterAuthoritativeHistory(
      { id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" },
      "rollout-2026-05-31T14-38-56-runtime-1",
      "D:/repo",
    );

    assert.equal(history?.messages[0]?.text, "加载 Codex 历史");
  } finally {
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
