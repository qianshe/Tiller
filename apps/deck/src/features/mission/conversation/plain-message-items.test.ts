import assert from "node:assert/strict";
import test from "node:test";
import { writeClipboardText } from "./plain-message-items.js";

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
