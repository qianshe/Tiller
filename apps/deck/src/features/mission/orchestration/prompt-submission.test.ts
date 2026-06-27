import assert from "node:assert/strict";
import test from "node:test";
import { submitPromptRequest } from "./prompt-submission.js";

function flushPromises() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const traces: unknown[] = [];
  const cleared: string[] = [];
  const appended: unknown[] = [];
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
    appendExistingSessionPrompt: (
      sessionId: string,
      text: string,
      id: string,
      images: unknown[],
    ) => appended.push({ sessionId, text, id, images }),
    tracePromptSubmit: (input: unknown) => traces.push(input),
    ...overrides,
  } as any;
  return { dependencies, dispatched, traces, cleared, appended };
}

test("submitPromptRequest dispatches existing-session prompts with a matching trace id", async () => {
  const { dependencies, dispatched, traces, cleared, appended } = createDependencies();

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
  assert.deepEqual(cleared, ["notice:", "prompt:", "images:0"]);
  assert.deepEqual(appended, []);

  await flushPromises();

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
  assert.deepEqual(appended, [
    { sessionId: "session-1", text: "hello", id: "client-session-1", images: [] },
  ]);
});

test("submitPromptRequest prepares an existing image session before dispatching the prompt", async () => {
  let releasePrepare!: () => void;
  const prepareGate = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  const calls: string[] = [];
  const image = {
    type: "image" as const,
    data: "data:image/png;base64,AAA",
    mimeType: "image/png",
    name: "screen.png",
  };
  const { dependencies, dispatched } = createDependencies({
    prepareExistingSessionPrompt: async (sessionId: string) => {
      calls.push(`prepare:${sessionId}`);
      await prepareGate;
      calls.push(`prepared:${sessionId}`);
    },
    appendExistingSessionPrompt: (
      sessionId: string,
      text: string,
      id: string,
      images: unknown[],
    ) => {
      calls.push(`append:${sessionId}:${text}:${id}:${images.length}`);
    },
    dispatch: (_client: unknown, method: string, params: unknown) => {
      calls.push(`dispatch:${method}`);
      dispatched.push({ method, params });
      return Promise.resolve({});
    },
  });

  const submitted = submitPromptRequest(
    {
      prompt: "  看这张图  ",
      promptImages: [image],
      activeSessionId: "session-1",
    },
    dependencies,
  );

  assert.equal(submitted, true);
  assert.deepEqual(calls, ["prepare:session-1"]);
  assert.deepEqual(dispatched, []);

  releasePrepare();
  await flushPromises();

  assert.deepEqual(calls, [
    "prepare:session-1",
    "prepared:session-1",
    "dispatch:session/prompt",
    "append:session-1:看这张图:client-session-1:1",
  ]);
  assert.deepEqual(dispatched, [
    {
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        text: "看这张图",
        content: [{ type: "text", text: "看这张图" }, image],
        clientMessageId: "client-session-1",
      },
    },
  ]);
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

test("submitPromptRequest does not append user message when prompt is queued", async () => {
  const { dependencies, appended } = createDependencies({
    dispatch: () => Promise.resolve({ accepted: "queued" }),
  });

  const submitted = submitPromptRequest(
    {
      prompt: "queued message",
      promptImages: [],
      activeSessionId: "session-1",
    },
    dependencies,
  );

  assert.equal(submitted, true);
  await flushPromises();
  assert.deepEqual(appended, []);
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
