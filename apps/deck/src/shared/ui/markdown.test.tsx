import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage, normalizeMarkdownMessageText } from "./markdown.js";

test("markdown tables render inside a responsive scroll wrapper", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={["| 列 1 | 列 2 |", "| --- | --- |", "| 内容 A | 内容 B |"].join("\n")}
    />,
  );

  assert.match(html, /<div class="markdown-table-scroll">/);
  assert.match(html, /<table>/);
});

test("assistant markdown text inserts paragraph breaks at ACP boundary markers", () => {
  const normalized = normalizeMarkdownMessageText(
    "Fallback metadata issues.我会继续排查喵~[🌳木] 已定位根因。",
  );
  const html = renderToStaticMarkup(<MarkdownMessage text={normalized} />);

  assert.match(normalized, /issues\.\n\n我会继续排查喵~\n\n\[🌳木\]/);
  assert.equal((html.match(/class="markdown-paragraph/g) ?? []).length, 3);
});

test("thinking paragraphs receive a dedicated markdown class hook", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["Thinking: verify the session replay boundary.", "普通段落内容。"].join("\n\n")} />,
  );

  assert.match(html, /markdown-paragraph markdown-paragraph-thinking/);
  assert.match(html, /<p class="markdown-paragraph">普通段落内容。<\/p>/);
});