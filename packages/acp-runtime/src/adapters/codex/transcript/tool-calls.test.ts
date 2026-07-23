import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractCodexToolCallsFromTranscriptText,
  readCodexTranscriptToolCallsFromDisk,
  resolveCodexTranscriptPath,
} from "./tool-calls.js";

test("resolveCodexTranscriptPath finds rollout files by runtime session id", () => {
  const codexDir = mkdtempSync(join(tmpdir(), "tiller-codex-transcript-"));
  const sessionDir = join(codexDir, "sessions", "2026", "07", "07");
  mkdirSync(sessionDir, { recursive: true });
  const transcriptPath = join(
    sessionDir,
    "rollout-2026-07-07T19-03-16-019f3c3f-0732-7461-b3b5-1992ad381665.jsonl",
  );
  writeFileSync(transcriptPath, "", "utf8");

  assert.equal(
    resolveCodexTranscriptPath({
      runtimeSessionId: "019f3c3f-0732-7461-b3b5-1992ad381665",
      cwd: "D:/repo",
      codexConfigDir: codexDir,
    }),
    transcriptPath,
  );
});

test("extractCodexToolCallsFromTranscriptText restores Codex tool kinds and titles", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-07T14:25:37.376Z",
      type: "event_msg",
      payload: {
        type: "web_search_end",
        call_id: "ws-search",
        query: "OpenAI developer docs Responses API official",
        action: {
          type: "search",
          query: "OpenAI developer docs Responses API official",
          queries: ["OpenAI developer docs Responses API official"],
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:05:55.558Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command:
            "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
          timeout_ms: 10000,
        }),
        call_id: "call-skill",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:03.385Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-skill",
        output: "Exit code: 0\nWall time: 0.6 seconds\nOutput:\nname: using-superpowers\n",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:05.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [{ step: "只更新计划", status: "in_progress" }],
        }),
        call_id: "call-plan",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:05.100Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-plan",
        output: "{\"ok\":true}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:10.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command: "Get-Location",
          workdir: "D:\\myProject\\tools\\Tiller",
          timeout_ms: 10000,
        }),
        call_id: "call-shell",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:06:11.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-shell",
        output: "Exit code: 0\nWall time: 0.6 seconds\nOutput:\nD:\\myProject\\tools\\Tiller\n",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:09:21.692Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "get_current_config",
        namespace: "mcp__mcp_router",
        arguments: JSON.stringify({}),
        call_id: "call-mcp",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T11:09:21.845Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-mcp",
        output: "{\"project\":\"Tiller\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T12:12:35.875Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        status: "completed",
        call_id: "call-write",
        name: "apply_patch",
        input: "*** Begin Patch\n*** Add File: D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt\n+ok\n*** End Patch\n",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T12:12:35.940Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-write",
        output: "Success. Updated the following files:\nA D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt\n",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T12:39:49.467Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        namespace: "multi_agent_v1",
        arguments: JSON.stringify({ fork_context: true, message: "只读测试" }),
        call_id: "call-subagent",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T12:39:59.696Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-subagent",
        output: "{\"agent_id\":\"agent-1\",\"nickname\":\"Meitner\"}",
      },
    }),
  ].join("\n");

  const toolCalls = extractCodexToolCallsFromTranscriptText(transcript);

  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [
      ["ws-search", "fetch", "Searching for: OpenAI developer docs Responses API official"],
      ["call-skill", "skill", "Skill: superpowers:using-superpowers"],
      ["call-shell", "shell", "Get-Location"],
      ["call-mcp", "mcp", "Tool: mcp_router/get_current_config"],
      ["call-write", "write", "Edit D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt"],
      ["call-subagent", "subagent", "spawn_agent"],
    ],
  );
  assert.deepEqual(toolCalls[3]?.mcp, {
    serverName: "mcp_router",
    toolName: "get_current_config",
    source: "structured-tool-name",
    rawTitle: "mcp__mcp_router/get_current_config",
  });
  assert.equal(toolCalls[0]?.sequence, undefined);
  assert.equal(toolCalls.some((toolCall) => toolCall.id === "call-plan"), false);
});

test("extractCodexToolCallsFromTranscriptText compacts view_image outputs into lightweight summaries", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-07T14:26:03.404Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "view_image",
        arguments: JSON.stringify({
          path: "D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
          detail: "high",
        }),
        call_id: "call-view-image",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T14:26:03.522Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-view-image",
        output: [{
          type: "input_image",
          image_url: `data:image/png;base64,${"A".repeat(2048)}`,
          detail: "high",
        }],
      },
    }),
  ].join("\n");

  const toolCalls = extractCodexToolCallsFromTranscriptText(transcript);

  assert.deepEqual(toolCalls, [
    {
      id: "call-view-image",
      kind: "read",
      title: "D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
      status: "completed",
      input: JSON.stringify({
        path: "D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
        detail: "high",
      }),
      output: [
        "[image content omitted from history]",
        "path: D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
        "mimeType: image/png",
        "detail: high",
      ].join("\n"),
      timestamp: "2026-07-07T14:26:03.404Z",
      updatedAt: "2026-07-07T14:26:03.522Z",
      sequence: 1,
    },
  ]);
});

test("extractCodexToolCallsFromTranscriptText classifies bare Codex multi-agent calls without namespace as subagents", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-08T11:45:06.872Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        arguments: JSON.stringify({
          fork_context: true,
          message: "只允许修改 docs/tooling/subagent-todolist-demo.md",
        }),
        call_id: "call-subagent-bare",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-08T11:45:17.132Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-subagent-bare",
        output: "{\"agent_id\":\"agent-1\",\"nickname\":\"Maxwell\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-08T11:45:25.514Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "wait_agent",
        arguments: JSON.stringify({
          targets: ["019f418b-c549-7200-8ff1-8d2dd4ef002e"],
          timeout_ms: 120000,
        }),
        call_id: "call-wait-bare",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-08T11:47:25.533Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-wait-bare",
        output: "{\"status\":{},\"timed_out\":true}",
      },
    }),
  ].join("\n");

  const toolCalls = extractCodexToolCallsFromTranscriptText(transcript);

  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [
      ["call-subagent-bare", "subagent", "spawn_agent"],
      ["call-wait-bare", "subagent", "wait_agent"],
    ],
  );
});

test("readCodexTranscriptToolCallsFromDisk reads matching rollout files", () => {
  const codexDir = mkdtempSync(join(tmpdir(), "tiller-codex-transcript-"));
  const sessionDir = join(codexDir, "sessions", "2026", "07", "07");
  mkdirSync(sessionDir, { recursive: true });
  const transcriptPath = join(
    sessionDir,
    "rollout-2026-07-07T19-03-16-019f3c3f-0732-7461-b3b5-1992ad381665.jsonl",
  );
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        timestamp: "2026-07-07T11:05:55.558Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell_command",
          arguments: JSON.stringify({ command: "Get-Location" }),
          call_id: "call-shell",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-07T11:06:03.385Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-shell",
          output: "Exit code: 0",
        },
      }),
    ].join("\n"),
    "utf8",
  );

  const toolCalls = readCodexTranscriptToolCallsFromDisk({
    runtimeSessionId: "019f3c3f-0732-7461-b3b5-1992ad381665",
    cwd: "D:/repo",
    codexConfigDir: codexDir,
  });

  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [["call-shell", "shell", "Get-Location"]],
  );
});
