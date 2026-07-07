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
  assert.doesNotMatch(html, /-mt-/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /overflow-y-hidden/);
  assert.match(html, /max-w-full/);
  assert.match(html, /<table/);
  assert.match(html, /min-w-max/);
  assert.match(html, /markdown-table-head/);
  assert.match(html, /markdown-table-cell/);
  assert.match(html, /text-\[12px\]/);
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

test("markdown can repair underspecified delimiter rows for completed tables", () => {
  const text = [
    "| Plan | 复选框 | 代码验证 | 状态 |",
    "|---|",
    "| 2026-07-06-stale-session-model-sync.md | 0/17 | ✅ commit 08f8fd3 完整实现 | 已完成 |",
    "| 2026-07-03-mission-git-remote-sync-phase-1.md | 0/30 | ❌ 无 `project/git/push\\|pull`、`refreshRemote` | 未完成 |",
  ].join("\n");
  const normalized = normalizeMarkdownMessageText(text, { repairMalformedTables: true });
  const html = renderToStaticMarkup(
    <MarkdownMessage text={text} repairMalformedTables />,
  );

  assert.match(normalized, /\| --- \| --- \| --- \| --- \|/);
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /<th[^>]*>Plan<\/th>/);
  assert.match(html, /<td[^>]*>2026-07-06-stale-session-model-sync\.md<\/td>/);
});

test("markdown leaves malformed tables untouched unless repair is enabled", () => {
  const text = [
    "| Plan | 复选框 | 代码验证 | 状态 |",
    "|---|",
    "| 2026-07-06-stale-session-model-sync.md | 0/17 | ✅ commit 08f8fd3 完整实现 | 已完成 |",
  ].join("\n");
  const normalized = normalizeMarkdownMessageText(text);
  const html = renderToStaticMarkup(<MarkdownMessage text={text} />);

  assert.doesNotMatch(normalized, /\| --- \| --- \| --- \| --- \|/);
  assert.doesNotMatch(html, /<table/);
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

test("inline code renders with a dedicated compact code marker", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text="路径 `apps/deck/src/App.tsx` 已更新。" />,
  );

  assert.match(html, /markdown-inline-code/);
  assert.match(html, /border-border-ghost/);
  assert.match(html, /bg-surface-emphasis\/70/);
  assert.match(html, /box-decoration-clone/);
  assert.match(html, /break-words/);
  assert.doesNotMatch(html, /font-mono/);
});

test("markdown headings stay message-sized instead of using browser default display sizes", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={"# Bug 根因分析\n\n## 概览：命令数据流"} />,
  );

  assert.match(html, /markdown-heading/);
  assert.match(html, /markdown-heading pb-2/);
  assert.match(html, /text-\[14\.5px\]/);
  assert.match(html, /text-\[13\.5px\]/);
  assert.doesNotMatch(html, /markdown-heading[^"]*my-/);
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
  assert.match(html, /全屏查看/);
  assert.doesNotMatch(html, /markdown-code-block/);
});

test("markdown waits for a closing Mermaid fence before rendering a diagram shell", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["```mermaid", "flowchart TD", "  A -->"].join("\n")} />,
  );

  assert.doesNotMatch(html, /markdown-mermaid-block/);
  assert.match(html, /markdown-code-block/);
});

test("markdown can defer Mermaid diagrams to a plain code block", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={["```mermaid", "flowchart TD", "  A --> B", "```"].join("\n")}
      renderMermaid={false}
    />,
  );

  assert.doesNotMatch(html, /markdown-mermaid-block/);
  assert.match(html, /markdown-code-block/);
  assert.match(html, /language-mermaid/);
});

test("markdown code highlighting reuses cached results for identical code", async () => {
  clearMarkdownHighlightCache();

  const first = await resolveMarkdownCodeHighlight("const value = 1;", "ts");
  const second = await resolveMarkdownCodeHighlight("const value = 1;", "ts");

  assert.equal(first, second);
  assert.equal(getMarkdownHighlightCacheSize(), 1);
});

test("markdown paragraphs use relaxed line height without extra block margins", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["第一段内容。", "", "第二段内容。"].join("\n")} />,
  );

  assert.match(
    html,
    /<p class="markdown-paragraph[^"]*leading-\[1\.72\][^"]*">第一段内容。<\/p>/,
  );
  assert.doesNotMatch(html, /<p class="markdown-paragraph[^"]*my-/);
});

test("markdown message container owns top-level block spacing", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={["第一段内容。", "", "第二段内容。"].join("\n")} />,
  );

  assert.match(
    html,
    /<div class="markdown-message[^"]*space-y-4[^"]*text-\[12px\][^"]*leading-\[1\.5\][^"]*">/,
  );
});

test("markdown lists rely on container spacing while keeping compact internal rhythm", () => {
  const htmlUl = renderToStaticMarkup(
    <MarkdownMessage text={["- 项目 1", "- 项目 2 with wrapped English text"].join("\n")} />,
  );
  const htmlOl = renderToStaticMarkup(
    <MarkdownMessage text={["1. 项目 1", "2. 项目 2 with wrapped English text"].join("\n")} />,
  );
  const htmlQuote = renderToStaticMarkup(
    <MarkdownMessage text={"> 引用段落"} />,
  );

  assert.match(htmlUl, /<ul[^>]*class="[^"]*space-y-1[^"]*"/);
  assert.match(htmlOl, /<ol[^>]*class="[^"]*space-y-1[^"]*"/);
  assert.match(htmlUl, /<li[^>]*class="[^"]*leading-\[1\.6\][^"]*"/);
  assert.match(htmlOl, /<li[^>]*class="[^"]*leading-\[1\.6\][^"]*"/);
  assert.doesNotMatch(htmlUl, /<ul[^>]*class="[^"]*my-/);
  assert.doesNotMatch(htmlOl, /<ol[^>]*class="[^"]*my-/);
  assert.doesNotMatch(htmlQuote, /<blockquote[^>]*class="[^"]*my-/);
});
