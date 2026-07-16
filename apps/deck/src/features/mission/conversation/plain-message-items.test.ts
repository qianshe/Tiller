import assert from "node:assert/strict";
import test from "node:test";
import {
  isThinkingScrollNearBottom,
  resolveToolCallDisplayTitle,
  resolveThinkingContentClassName,
  writeClipboardText,
} from "./plain-message-items.js";

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
