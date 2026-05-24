import assert from "node:assert/strict";
import test from "node:test";
import { submitPromptRequest } from "./prompt-submission.js";

function createDependencies(overrides: Record<string, unknown> = {}) {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const traces: unknown[] = [];
  const cleared: string[] = [];
  const dependencies = {
    client: { socket: { readyState: 1 } },
    createSession: () => true,
    setImagePasteNotice: (value: string) => cleared.push(`notice:${value}`),
    setPrompt: (value: string) => cleared.push(`prompt:${value}`),
    setPromptImages: (images: unknown[]) => cleared.push(`images:${images.length}`),
    createClientUserMessageId: (sessionId: string) => `client-${sessionId}`,
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return Promise.resolve({});
    },
    tracePromptSubmit: (input: unknown) => traces.push(input),
    ...overrides,
  } as any;
  return { dependencies, dispatched, traces, cleared };
}

test("submitPromptRequest dispatches existing-session prompts with a matching trace id", () => {
  const { dependencies, dispatched, traces, cleared } = createDependencies();

  const submitted = submitPromptRequest(
    {
      prompt: "  hello  ",
      promptImages: [],
      activeSessionId: "session-1",
    },
    dependencies,
  );

  assert.equal(submitted, true);
  assert.deepEqual(traces, [
    {
      traceId: "client-session-1",
      sessionId: "session-1",
      text: "hello",
      imageCount: 0,
    },
  ]);
  assert.deepEqual(dispatched, [
    {
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        text: "hello",
        content: undefined,
        clientMessageId: "client-session-1",
      },
    },
  ]);
  assert.deepEqual(cleared, ["notice:", "prompt:", "images:0"]);
});

test("submitPromptRequest preserves the no-session create path", () => {
  const created: unknown[] = [];
  const { dependencies, dispatched, traces, cleared } = createDependencies({
    createSession: (initialPrompt: string, initialContent: unknown) => {
      created.push({ initialPrompt, initialContent });
      return true;
    },
  });

  const submitted = submitPromptRequest(
    {
      prompt: "hello",
      promptImages: [],
      activeSessionId: null,
    },
    dependencies,
  );

  assert.equal(submitted, true);
  assert.deepEqual(created, [{ initialPrompt: "hello", initialContent: undefined }]);
  assert.deepEqual(dispatched, []);
  assert.deepEqual(traces, []);
  assert.deepEqual(cleared, ["notice:", "prompt:", "images:0"]);
});

test("submitPromptRequest does not dispatch when chat is restore-gated", () => {
  const { dependencies, dispatched, traces, cleared } = createDependencies();

  const submitted = submitPromptRequest(
    {
      prompt: "hello",
      promptImages: [],
      activeSessionId: "session-1",
      activeSessionCanChat: false,
    },
    dependencies,
  );

  assert.equal(submitted, false);
  assert.deepEqual(dispatched, []);
  assert.deepEqual(traces, []);
  assert.deepEqual(cleared, ["notice:"]);
});
