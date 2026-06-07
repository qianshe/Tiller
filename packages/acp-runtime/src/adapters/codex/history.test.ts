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

test("parseCodexJsonlHistory reads Codex ACP visible user messages", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-06-05T16:35:56.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "client-user-1",
          message: "继续检查 Codex 历史",
          images: [{ type: "input_image", image_url: "data:image/png;base64,img" }],
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "client-user-1",
      role: "user",
      text: "继续检查 Codex 历史",
      timestamp: "2026-06-05T16:35:56.000Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "img",
          mimeType: "image/png",
          name: "client-user-1-image-1.png",
        },
      ],
    },
  ]);
});

test("parseCodexJsonlHistory hides injected AGENTS instructions from visible messages", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-06-07T12:01:29.468Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "# AGENTS.md instructions for D:\\myProject\\tools\\Tiller\n\n<INSTRUCTIONS>...",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-07T12:01:31.389Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "client-user-1",
          message: "我准备开始做 commit",
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    history.messages.map((message) => [message.id, message.role, message.text]),
    [["client-user-1", "user", "我准备开始做 commit"]],
  );
});

test("parseCodexJsonlHistory deduplicates matching response and event user messages", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-06-05T16:35:56.371Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "继续检查 Codex 历史" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-05T16:35:56.372Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "client-user-1",
          message: "继续检查 Codex 历史",
        },
      }),
    ].join("\n"),
  );

  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0]?.role, "user");
  assert.equal(history.messages[0]?.text, "继续检查 Codex 历史");
});

test("parseCodexJsonlHistory keeps repeated visible messages outside the duplicate window", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-06-05T16:35:56.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "user-1",
          message: "继续",
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-05T16:35:56.500Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "user-2",
          message: "继续",
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    history.messages.map((message) => message.id),
    ["user-1", "user-2"],
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

test("parseCodexJsonlHistory derives the latest update_plan tool as a plan without polluting message history", () => {
  const history = parseCodexJsonlHistory(
    [
      JSON.stringify({
        timestamp: "2026-05-31T06:38:58.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          client_id: "client-user-1",
          message: "检查 Codex plan 展示",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:38:59.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          namespace: "functions",
          arguments: JSON.stringify({
            plan: [
              { step: "检查历史导入", status: "completed" },
              { step: "恢复 Codex plan", status: "in_progress" },
            ],
          }),
          call_id: "call-plan",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:39:00.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-plan", output: "ok" },
      }),
      JSON.stringify({
        timestamp: "2026-05-31T06:39:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "消息和 plan 都正常" }],
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    history.messages.map((message) => [message.role, message.text]),
    [
      ["user", "检查 Codex plan 展示"],
      ["assistant", "消息和 plan 都正常"],
    ],
  );
  assert.deepEqual(history.toolCalls, []);
  assert.deepEqual(history.plan?.entries, [
    { content: "检查历史导入", priority: "medium", status: "completed" },
    { content: "恢复 Codex plan", priority: "medium", status: "in_progress" },
  ]);
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

test("loadAdapterAuthoritativeHistory finds Codex rollout files by session id suffix", async () => {
  const home = mkdtempSync(join(tmpdir(), "tiller-codex-history-"));
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    const sessionDir = join(home, ".codex", "sessions", "2026", "06", "07");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "rollout-2026-06-07T19-59-34-019ea1f3-cc55-7233-a126-394d0c2b1751.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-07T13:58:27.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            client_id: "client-user-1",
            message: "加载 Codex 后缀历史",
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-07T13:58:28.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "update_plan",
            namespace: "functions",
            arguments: JSON.stringify({
              plan: [{ step: "随历史加载 Codex plan", status: "in_progress" }],
            }),
            call_id: "call-plan",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const history = await loadAdapterAuthoritativeHistory(
      { id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" },
      "019ea1f3-cc55-7233-a126-394d0c2b1751",
      "D:/repo",
    );

    assert.equal(history?.messages[0]?.text, "加载 Codex 后缀历史");
    assert.deepEqual(history?.plan?.entries, [
      { content: "随历史加载 Codex plan", priority: "medium", status: "in_progress" },
    ]);
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
