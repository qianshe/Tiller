import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "./clipboard.js";

test("copyTextToClipboard writes the original text via the clipboard when available", async () => {
  let copied = "";
  await copyTextToClipboard("  assistant reply\n", {
    writeText: async (text) => {
      copied = text;
    },
  });
  assert.equal(copied, "  assistant reply\n");
});

test("copyTextToClipboard rejects empty text", async () => {
  await assert.rejects(
    () => copyTextToClipboard("   ", { writeText: async () => {} }),
    /Clipboard unavailable/,
  );
});

test("copyTextToClipboard falls back to execCommand when the async clipboard is unavailable", async () => {
  const originalDocument = globalThis.document;
  let execCalled = false;
  globalThis.document = {
    createElement: () => ({
      value: "",
      setAttribute: () => {},
      style: {},
      select: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => {
      execCalled = true;
      return true;
    },
  } as unknown as Document;
  try {
    await copyTextToClipboard("hello", undefined);
    assert.equal(execCalled, true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("copyTextToClipboard rejects when both clipboard and execCommand are unavailable", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      value: "",
      setAttribute: () => {},
      style: {},
      select: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => false,
  } as unknown as Document;
  try {
    await assert.rejects(
      () => copyTextToClipboard("hello", undefined),
      /Clipboard unavailable/,
    );
  } finally {
    globalThis.document = originalDocument;
  }
});
