import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "./markdown.js";

test("markdown tables render inside a responsive scroll wrapper", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      text={["| 列 1 | 列 2 |", "| --- | --- |", "| 内容 A | 内容 B |"].join("\n")}
    />,
  );

  assert.match(html, /<div class="markdown-table-scroll">/);
  assert.match(html, /<table>/);
});
