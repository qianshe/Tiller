import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildMissionPromptText,
  parseMissionPromptContext,
} from "@tiller/shared";
import {
  isThinkingScrollNearBottom,
  PlainSubagentItem,
  PlainToolCallItem,
  PlainThinkingItem,
  resolveToolCallDisplayTitle,
  resolveThinkingContentClassName,
  writeClipboardText,
} from "./plain-message-items.js";
import { PlainMessageItem } from "./plain-message-items.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const plainMessageItemsSource = readFileSync(
  resolve(currentDir, "./plain-message-items.tsx"),
  "utf8",
);

test("resolveToolCallDisplayTitle removes the redundant Tool prefix after the MCP badge", () => {
  assert.equal(
    resolveToolCallDisplayTitle("MCP", "Tool: context7/resolve-library-id"),
    "context7/resolve-library-id",
  );
  assert.equal(
    resolveToolCallDisplayTitle("MCP", "Tool: context7/query-docs"),
    "context7/query-docs",
  );
});

test("writeClipboardText writes the original text to clipboard", async () => {
  let copiedText = "";

  await writeClipboardText("  assistant reply\n", {
    writeText: async (text) => {
      copiedText = text;
    },
  });

  assert.equal(copiedText, "  assistant reply\n");
});

test("writeClipboardText rejects empty text or unavailable clipboard", async () => {
  await assert.rejects(
    () => writeClipboardText("   ", { writeText: async () => {} }),
    /Clipboard unavailable/,
  );
  await assert.rejects(
    () => writeClipboardText("assistant reply", undefined),
    /Clipboard unavailable/,
  );
});

test("isThinkingScrollNearBottom only follows the stream when the user stays near the bottom", () => {
  assert.equal(
    isThinkingScrollNearBottom({
      scrollTop: 176,
      clientHeight: 200,
      scrollHeight: 400,
    }),
    true,
  );
  assert.equal(
    isThinkingScrollNearBottom({
      scrollTop: 80,
      clientHeight: 200,
      scrollHeight: 400,
    }),
    false,
  );
});

test("resolveThinkingContentClassName keeps short running thinking panels content-sized", () => {
  assert.doesNotMatch(
    resolveThinkingContentClassName({
      isRunning: true,
      text: "短一点的 thinking",
    }),
    /max-h-64|h-64/,
  );

  assert.match(
    resolveThinkingContentClassName({
      isRunning: true,
      text: Array.from({ length: 18 }, () => "这是较长的 thinking 内容").join("\n"),
    }),
    /max-h-64/,
  );
});

test("PlainThinkingItem keeps the summary label stable while thinking streams", () => {
  const html = renderToStaticMarkup(
    createElement(PlainThinkingItem, {
      items: [{
        id: "thinking-1",
        kind: "thinking",
        text: "先分析当前文件",
        title: "Thinking",
        status: "running",
        timestamp: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      }],
    }),
  );
  const summary = html.slice(0, html.indexOf("</summary>"));

  assert.match(summary, />Thinking<\/span>/u);
  assert.doesNotMatch(summary, /先分析当前文件/u);
});

test("PlainSubagentItem renders OpenCode output and model metadata", () => {
  const html = renderToStaticMarkup(
    createElement(PlainSubagentItem, {
      item: {
        kind: "tool",
        id: "tool-opencode-subagent",
        commandId: "subagent:task-42",
        title: "Sisyphus-Junior",
        status: "completed",
        toolKind: "subagent",
        timestamp: "2026-07-03T10:00:00.000Z",
        text: JSON.stringify({
          output: "Task completed in 20s.\n\nhello from subagent",
          metadata: {
            agent: "Sisyphus-Junior",
            requested_subagent_type: "sisyphus-junior",
          },
        }),
        input: JSON.stringify({
          agent: "Sisyphus-Junior",
          category: "quick",
          model: {
            modelID: "deepseek-v4-flash",
            variant: "low",
          },
        }),
        streams: [],
      },
    }),
  );

  assert.match(html, /Task completed in 20s\./u);
  assert.match(html, /hello from subagent/u);
  assert.match(html, />quick<\/span>/u);
  assert.doesNotMatch(html, /Sisyphus-Junior/u);
  assert.match(html, /modelID:[\s\S]*deepseek-v4-flash/u);
  assert.match(html, /variant:[\s\S]*low/u);
  assert.doesNotMatch(html, /requested_subagent_type|providerID|metadata/u);
});

test("PlainToolCallItem renders an OpenCode new-file Write as a diff", () => {
  const content = "# OpenCode test\n\nCreated by Write.";
  const html = renderToStaticMarkup(
    createElement(PlainToolCallItem, {
      item: {
        kind: "tool",
        id: "tool-opencode-write",
        commandId: "tool-opencode-write",
        title: "docs/opencode-write-test.md",
        status: "completed",
        toolKind: "write",
        timestamp: "2026-08-06T10:00:00.000Z",
        text: JSON.stringify({
          output: "Wrote file successfully.",
          metadata: {
            filepath: "D:/myProject/tools/Tiller/docs/opencode-write-test.md",
            exists: false,
            diagnostics: {},
          },
        }),
        input: JSON.stringify({
          filePath: "docs/opencode-write-test.md",
          content,
        }),
        streams: [],
      },
    }),
  );

  assert.match(html, /修改统计：新增 3 行，删除 0 行/u);
  assert.match(html, /\+# OpenCode test/u);
  assert.doesNotMatch(html, /Wrote file successfully\./u);
});

test("plain message parser keeps sent context trigger above the message bubble", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessageItem, {
      isExpanded: true,
      onToggleExpandedMessage: () => undefined,
      message: {
        id: "m1",
        role: "user",
        timestamp: "2026-07-03T10:00:00.000Z",
        text: buildMissionPromptText("帮我展开", [{
          id: "ctx-1",
          kind: "quote",
          label: "assistant 引用",
          comment: "继续追问",
          excerpt: "use MCP tools first",
          source: { kind: "quote", messageId: "a1", role: "assistant" },
        }]),
      },
      onAddDraftContext: () => undefined,
    } as any),
  );

  assert.match(html, /aria-label="评论 1，展开查看"/u);
  assert.match(html, /aria-expanded="false"/u);
  assert.ok(html.indexOf('aria-label="已发送评论"') < html.indexOf("plain-message-user-row"));
  assert.doesNotMatch(html, /继续追问/u);
  assert.match(html, /帮我展开/);
  assert.doesNotMatch(html, /\[TILLER_CONTEXT/u);
  assert.match(plainMessageItemsSource, /<PromptContextMenu[\s\S]*align="end"/u);
  assert.match(plainMessageItemsSource, /data-prompt-context-boundary="message"/u);
  assert.match(plainMessageItemsSource, /max-w-\[min\(56rem,76%\)\]/u);
  assert.doesNotMatch(plainMessageItemsSource, /item\.excerpt/u);
});

test("plain message copy path strips compiled prompt markers before writing to clipboard", () => {
  assert.match(plainMessageItemsSource, /stripMissionPromptContext\(message\.text\)/);
});

test("end-to-end codec: buildMissionPromptText output parses back into chips and body", () => {
  const compiled = buildMissionPromptText("看看改动", [{
    id: "ctx-e2e",
    kind: "diff",
    label: "a.ts:10-12",
    comment: "end-to-end 校验",
    excerpt: "+ hello",
    source: { kind: "diff", filePath: "a.ts", startLine: 10, endLine: 12 },
  }]);
  const parsed = parseMissionPromptContext(compiled);

  assert.equal(parsed.body, "看看改动");
  assert.equal(parsed.contexts.length, 1);
  assert.equal(parsed.contexts[0]?.comment, "end-to-end 校验");
  assert.equal(parsed.contexts[0]?.label, "a.ts:10-12");
  assert.equal(parsed.contexts[0]?.excerpt, "+ hello");
});
