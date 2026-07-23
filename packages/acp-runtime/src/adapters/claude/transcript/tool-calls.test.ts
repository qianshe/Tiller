import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractClaudeToolCallsFromTranscriptText,
  readClaudeTranscriptToolUseFromDisk,
} from "./tool-calls.js";

test("extractClaudeToolCallsFromTranscriptText restores Claude transcript tool names and kinds", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-07T07:10:00.276Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-read",
            name: "Read",
            input: {
              file_path: "D:\\myProject\\tools\\Tiller\\docs\\superpowers\\plans\\2026-07-07-mobile-composer-density-and-commit-button.md",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T07:10:00.540Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-read",
            content: "1\t# Mobile Composer Density And Commit Button Implementation Plan",
            is_error: false,
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T07:10:24.270Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-bash",
            name: "Bash",
            input: {
              command:
                "echo \"=== form.tsx mobile variants ===\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30",
              description: "检查实现内容是否存在",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T07:10:24.960Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-bash",
            content: "=== form.tsx mobile variants ===",
            is_error: false,
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-14T07:44:04.680Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-mcp",
            name: "mcpServers_search_context",
            input: {
              project_root_path: "D:\\myProject\\tools\\Tiller",
              query: "session creation flow",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-14T07:44:05.166Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-mcp",
            content: "match",
            is_error: false,
          },
        ],
      },
    }),
  ].join("\n");

  const toolCalls = extractClaudeToolCallsFromTranscriptText(transcript);

  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [
      ["tool-read", "read", "Read"],
      [
        "tool-bash",
        "shell",
        "echo \"=== form.tsx mobile variants ===\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30",
      ],
      ["tool-mcp", "mcp", "Tool: search_context"],
    ],
  );
  assert.match(toolCalls[0]?.input ?? "", /mobile-composer-density-and-commit-button/);
  assert.match(toolCalls[1]?.input ?? "", /grep -nE 'isMobile\|py-1'/);
  assert.match(toolCalls[2]?.input ?? "", /session creation flow/);
  assert.deepEqual(toolCalls[2]?.mcp, {
    toolName: "search_context",
    source: "provider-title",
    rawTitle: "mcpServers_search_context",
  });
});

test("extractClaudeToolCallsFromTranscriptText can expose pending transcript tools", () => {
  const transcript = JSON.stringify({
    timestamp: "2026-07-14T15:43:19.667Z",
    message: {
      content: [{
        type: "tool_use",
        id: "call-running-shell",
        name: "Bash",
        input: {
          command: "node -e \"setTimeout(()=>console.log('LIVE'),20000)\"",
        },
      }],
    },
  });

  assert.deepEqual(extractClaudeToolCallsFromTranscriptText(transcript), []);
  assert.deepEqual(
    extractClaudeToolCallsFromTranscriptText(transcript, { includePending: true }),
    [{
      id: "call-running-shell",
      kind: "shell",
      title: "node -e \"setTimeout(()=>console.log('LIVE'),20000)\"",
      status: "running",
      input: JSON.stringify({
        command: "node -e \"setTimeout(()=>console.log('LIVE'),20000)\"",
      }),
      timestamp: "2026-07-14T15:43:19.667Z",
      updatedAt: "2026-07-14T15:43:19.667Z",
      sequence: 1,
    }],
  );
});

test("extractClaudeToolCallsFromTranscriptText restores completed background task notifications", () => {
  const transcript = JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    timestamp: "2026-07-19T14:12:55.834Z",
    content: [
      "<task-notification>",
      "<task-id>agent-1</task-id>",
      "<tool-use-id>call-agent-1</tool-use-id>",
      "<status>completed</status>",
      "<result>SUBAGENT_DONE</result>",
      "</task-notification>",
    ].join("\n"),
  });

  assert.deepEqual(extractClaudeToolCallsFromTranscriptText(transcript), [{
    id: "call-agent-1",
    commandId: "subagent:agent-1",
    kind: "subagent",
    title: "Subagent",
    status: "completed",
    output: "SUBAGENT_DONE",
    timestamp: "2026-07-19T14:12:55.834Z",
    updatedAt: "2026-07-19T14:12:55.834Z",
    sequence: 1,
  }]);
});

test("readClaudeTranscriptToolUseFromDisk finds a recent subagent shell command", () => {
  const root = join(tmpdir(), `tiller-claude-tool-${Date.now()}`);
  const cwd = "D:\\workspace\\project";
  const runtimeSessionId = "runtime-session";
  const projectDir = join(root, "projects", "D--workspace-project");
  const subagentDir = join(projectDir, runtimeSessionId, "subagents");
  mkdirSync(subagentDir, { recursive: true });
  writeFileSync(join(projectDir, `${runtimeSessionId}.jsonl`), "", "utf8");
  writeFileSync(
    join(subagentDir, "agent-test.jsonl"),
    [
      JSON.stringify({
        message: {
          content: [{
            type: "tool_use",
            id: "call-shell",
            name: "Bash",
            input: { command: "node -e \"console.log('proof')\"" },
          }],
        },
      }),
      JSON.stringify({ padding: "x".repeat(160 * 1024) }),
    ].join("\n"),
    "utf8",
  );

  try {
    assert.deepEqual(readClaudeTranscriptToolUseFromDisk({
      claudeConfigDir: root,
      cwd,
      runtimeSessionId,
      toolCallId: "call-shell",
    }), {
      name: "Bash",
      input: { command: "node -e \"console.log('proof')\"" },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
