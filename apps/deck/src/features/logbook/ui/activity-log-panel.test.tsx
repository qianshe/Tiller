import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogPanel } from "./activity-log-panel.js";

test("activity log panel excludes thinking tool calls from tool activity", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "Tab 替换边界探索",
          status: "completed",
          output: "内部探索内容",
          timestamp: "2026-05-17T10:00:00.000Z",
          updatedAt: "2026-05-17T10:00:01.000Z",
        },
        {
          id: "tool-1",
          kind: "shell",
          title: "pnpm test",
          status: "completed",
          output: "pass",
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:03.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.doesNotMatch(html, /Think/);
  assert.doesNotMatch(html, /Tab 替换边界探索/);
  assert.doesNotMatch(html, /内部探索内容/);
  assert.match(html, /Shell/);
  assert.match(html, /pnpm test/);
});

test("activity log panel falls back to command chunks when tool calls only contain thinking", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "分析执行边界",
          status: "completed",
          output: "内部 Thinking",
          timestamp: "2026-05-17T10:00:00.000Z",
          updatedAt: "2026-05-17T10:00:01.000Z",
        },
      ],
      commandChunks: [
        {
          id: "chunk-1",
          commandId: "cmd-1",
          stream: "stdout",
          text: "tool output",
          timestamp: "2026-05-17T10:00:02.000Z",
        },
      ],
      sessionMessages: [
        {
          id: "user-1",
          role: "user",
          text: "执行测试",
          timestamp: "2026-05-17T10:00:01.500Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /Prompt/);
  assert.match(html, /执行测试/);
  assert.match(html, /Shell/);
  assert.match(html, /cmd-1/);
  assert.match(html, /tool output/);
  assert.doesNotMatch(html, /分析执行边界/);
  assert.doesNotMatch(html, /内部 Thinking/);
});

test("activity log panel shows real user prompts and tool activity but hides assistant messages", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "shell",
          title: "bash",
          status: "completed",
          input: "git branch --show-current",
          output: "main",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:03.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [
        {
          id: "user-1",
          role: "user",
          text: "查看当前分支",
          timestamp: "2026-05-08T01:00:01.000Z",
        },
        {
          id: "wrapper-echo",
          role: "user",
          text: "[analyze-mode]\nSYNTHESIZE findings before proceeding.\n---\n查看当前分支",
          timestamp: "2026-05-08T01:00:01.500Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "当前分支是 main。",
          timestamp: "2026-05-08T01:00:04.000Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.doesNotMatch(html, /Assistant/);
  assert.doesNotMatch(html, /当前分支是 main。/);
  assert.doesNotMatch(html, /SYNTHESIZE findings/);
  assert.match(html, /Prompt/);
  assert.match(html, /查看当前分支/);
  assert.match(html, /Shell/);
  assert.match(html, /完成/);
  assert.match(html, /git branch --show-current/);
});


test("activity log panel shows tool arguments when output is empty", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "search",
          title: "Grep",
          status: "completed",
          input: JSON.stringify({ pattern: "航行日志", output_mode: "files_with_matches" }),
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:03.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /Search/);
  assert.match(html, /无输出，仅有调用参数/);
  assert.match(html, /pattern/);
  assert.match(html, /航行日志/);
});


test("activity log panel hides local command wrapper prompts and keeps stdout", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [],
      commandChunks: [],
      sessionMessages: [
        {
          id: "cmd-name",
          role: "user",
          text: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>",
          timestamp: "2026-05-17T10:00:00.000Z",
        },
        {
          id: "cmd-caveat",
          role: "user",
          text: "<local-command-caveat>Caveat: generated local command metadata</local-command-caveat>",
          timestamp: "2026-05-17T10:00:01.000Z",
        },
        {
          id: "cmd-stdout",
          role: "user",
          text: "<local-command-stdout>Set model to opus (claude-opus-4-7)</local-command-stdout>",
          timestamp: "2026-05-17T10:00:02.000Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /Set model to opus/);
  assert.doesNotMatch(html, /command-name/);
  assert.doesNotMatch(html, /local-command-caveat/);
  assert.doesNotMatch(html, /command-args/);
});

test("activity log panel labels namespaced tools as MCP", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Tool: sanshu/zhi",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /MCP/);
  assert.match(html, /sanshu\/zhi/);
  assert.doesNotMatch(html, /Tool: sanshu\/zhi/);
});

test("activity log panel labels command-shaped generic tools as shell", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Write-Output \"hello\"",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /Shell/);
  assert.match(html, /Write-Output/);
});

test("activity log panel does not render provider diagnostics as assistant activity", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Tool: read_file",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [
        {
          id: "session-1-msg-s0",
          role: "assistant",
          text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata;",
          timestamp: "2026-05-08T01:00:01.000Z",
        },
        {
          id: "session-1-msg-s1",
          role: "assistant",
          text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance.",
          timestamp: "2026-05-08T01:00:03.000Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  const assistantCards = html.match(/Assistant/g) ?? [];
  assert.equal(assistantCards.length, 0);
  assert.doesNotMatch(html, /this can degrade performance/);
  assert.match(html, /Tool/);
  assert.match(html, /Tool: read_file/);
});
