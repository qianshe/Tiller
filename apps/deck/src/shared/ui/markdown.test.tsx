import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clearMarkdownHighlightCache,
  getMarkdownHighlightCacheSize,
  MarkdownMessage,
  normalizeMarkdownMessageText,
  resolveMarkdownCodeHighlight,
} from "./markdown.js";

test("markdown tables render inside a responsive scroll wrapper", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={["| 列 1 | 列 2 |", "| --- | --- |", "| 内容 A | 内容 B |"].join("\n")}
    />,
  );

  assert.match(html, /markdown-table-scroll/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /overflow-y-hidden/);
  assert.match(html, /max-w-full/);
  assert.match(html, /<table/);
  assert.match(html, /min-w-max/);
  assert.match(html, /markdown-table-head/);
  assert.match(html, /markdown-table-cell/);
  assert.doesNotMatch(html, /whitespace-normal/);
  assert.doesNotMatch(html, /break-words/);
});

test("markdown renders only source tables as tables", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={[
        "| 项目 | 内容 |",
        "| --- | --- |",
        "| 产物 | apps/deck/src/features/logbook/message-history.ts |",
        "| 根因 | provider paragraph chunk 被当成独立 assistant |",
      ].join("\n")}
    />,
  );

  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /<th[^>]*>项目<\/th>/);
  assert.match(html, /<td[^>]*>apps\/deck\/src\/features\/logbook\/message-history\.ts<\/td>/);
});

test("markdown keeps labeled paragraphs as paragraphs instead of generated tables", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={[
        "自然语言说明。",
        "",
        "**产物**：apps/deck/src/features/logbook/message-history.ts",
        "**根因**：provider paragraph chunk 被当成独立 assistant",
      ].join("\n")}
    />,
  );

  assert.doesNotMatch(html, /<table/);
  assert.match(html, /markdown-paragraph/);
  assert.match(html, /<strong>产物<\/strong>：apps\/deck\/src\/features\/logbook\/message-history\.ts/);
});

test("inline code keeps the surrounding reading font instead of forcing monospace", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text="路径 `apps/deck/src/App.tsx` 已更新。" />,
  );

  assert.match(html, /rounded bg-surface-sunken/);
  assert.doesNotMatch(html, /font-mono/);
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

  assert.match(html, /markdown-paragraph[^\"]*markdown-paragraph-thinking/);
  assert.match(html, /<p class="markdown-paragraph[^\"]*">普通段落内容。<\/p>/);
});

test("markdown code block uses theme-aware code surface tokens", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["```ts", "const value = 1;", "```"].join("\n")} />,
  );

  assert.match(html, /bg-\[var\(--markdown-code-bg\)\]/);
  assert.match(html, /text-\[var\(--markdown-code-fg\)\]/);
  assert.match(html, /!bg-transparent/);
});

test("markdown renders Mermaid fences with a diagram shell", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["```mermaid", "flowchart TD", "  A --> B", "```"].join("\n")} />,
  );

  assert.match(html, /markdown-mermaid-block/);
  assert.match(html, /Mermaid/);
  assert.doesNotMatch(html, /markdown-code-block/);
});

test("markdown code highlighting reuses cached results for identical code", async () => {
  clearMarkdownHighlightCache();

  const first = await resolveMarkdownCodeHighlight("const value = 1;", "ts");
  const second = await resolveMarkdownCodeHighlight("const value = 1;", "ts");

  assert.equal(first, second);
  assert.equal(getMarkdownHighlightCacheSize(), 1);
});