import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider } from "@tiller/shared";
import { DEFAULT_ACP_PROMPT_START_TIMEOUT_MS } from "../constants";
import {
  ACP_PROMPT_STALLED_CODE,
  createAcpPromptStartGuard,
  isAcpPromptProgressEvent,
} from "./prompt-liveness";

test("prompt start guard allows two minutes for initial progress by default", () => {
  assert.equal(DEFAULT_ACP_PROMPT_START_TIMEOUT_MS, 2 * 60_000);
});

const provider: AcpAgentProvider = {
  id: "fake-acp",
  name: "Fake ACP",
  command: "fake",
  args: [],
  transport: "stdio",
  protocol: "acp",
  promptTimeoutMs: 20,
};

test("prompt start guard rejects when no provider progress arrives", async () => {
  const guard = createAcpPromptStartGuard(provider);
  const keepAlive = setTimeout(() => undefined, 100);
  try {
    await assert.rejects(guard.timeout, (error: unknown) => {
      assert.equal((error as { code?: string }).code, ACP_PROMPT_STALLED_CODE);
      return true;
    });
  } finally {
    clearTimeout(keepAlive);
    guard.dispose();
  }
});

test("prompt start guard is cancelled by provider progress", async () => {
  const guard = createAcpPromptStartGuard(provider);
  guard.markProgress();

  const outcome = await Promise.race([
    guard.timeout.then(() => "timeout", () => "rejected"),
    new Promise<"active">((resolve) => setTimeout(() => resolve("active"), 40)),
  ]);

  assert.equal(outcome, "active");
  guard.dispose();
});

test("prompt progress ignores metadata-only updates", () => {
  assert.equal(isAcpPromptProgressEvent({
    type: "usage-update",
    usage: { used: 0, size: 0 },
  }), false);
  assert.equal(isAcpPromptProgressEvent({
    type: "message",
    message: {
      id: "message-1",
      role: "assistant",
      text: "working",
      timestamp: "2026-07-16T00:00:00.000Z",
    },
  }), true);
});
