import assert from "node:assert/strict";
import test from "node:test";
import { extractClaudeToolCallsFromTranscriptText } from "./tool-calls.js";

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
      ["tool-bash", "shell", "Bash"],
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
