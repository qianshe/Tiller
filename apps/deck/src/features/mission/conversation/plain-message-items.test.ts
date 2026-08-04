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
