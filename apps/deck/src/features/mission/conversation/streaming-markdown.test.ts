import assert from "node:assert/strict";
import test from "node:test";
import { splitStreamingMarkdown } from "./streaming-markdown";

test("splitStreamingMarkdown separates completed markdown paragraph from streaming tail", () => {
  assert.deepEqual(splitStreamingMarkdown("# Title\n\nstreaming tail"), {
    markdown: "# Title",
    tail: "streaming tail",
  });
});

test("splitStreamingMarkdown waits for fenced code block closure", () => {
  assert.equal(splitStreamingMarkdown("```ts\nconst a = 1;\n"), null);
  assert.deepEqual(splitStreamingMarkdown("```ts\nconst a = 1;\n```\n\ntail"), {
    markdown: "```ts\nconst a = 1;\n```",
    tail: "tail",
  });
});

test("splitStreamingMarkdown returns null when no stable markdown exists", () => {
  assert.equal(splitStreamingMarkdown("streaming tail only"), null);
  assert.equal(splitStreamingMarkdown("\n\nstreaming tail"), null);
});
