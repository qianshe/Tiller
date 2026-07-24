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
  const retained: Array<string | null> = [];
  const dependencies = {
    client: { socket: { readyState: 1 } },
    createSession: () => true,
    setImagePasteNotice: (value: string) => cleared.push(`notice:${value}`),
    setPrompt: (value: string) => cleared.push(`prompt:${value}`),
    setPromptImages: (images: unknown[]) => cleared.push(`images:${images.length}`),
    clearDraftContexts: () => cleared.push("drafts:cleared"),
    setCommandRetentionNotice: (value: string | null) => retained.push(value),
    createClientUserMessageId: (sessionId: string) => `client-${sessionId}`,
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return Promise.resolve({ accepted: "sent" });
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
  return { dependencies, dispatched, traces, cleared, appended, retained };
}

const DIFF_CONTEXT = {
  id: "ctx-1",
  kind: "diff" as const,
  label: "a.ts:10-12",
  comment: "看看这里",
  excerpt: "+ hello",
  source: { kind: "diff" as const, filePath: "a.ts", startLine: 10, endLine: 12 },
};

test("submitPromptRequest dispatches existing-session prompts with a matching trace id", async () => {
  const { dependencies, dispatched, traces, cleared, appended, retained } = createDependencies();

  const submitted = submitPromptRequest(
    {
      prompt: "  hello  ",
      promptImages: [],
      draftContexts: [],
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
  assert.deepEqual(cleared, ["notice:", "prompt:", "images:0", "drafts:cleared"]);
  assert.deepEqual(retained, [null]);
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
      return Promise.resolve({ accepted: "sent" });
    },
  });

  const submitted = submitPromptRequest(
    {
      prompt: "  看这张图  ",
      promptImages: [image],
      draftContexts: [],
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
  const { dependencies, dispatched, traces, cleared, retained } = createDependencies({
    createSession: (initialPrompt: string, initialContent: unknown) => {
      created.push({ initialPrompt, initialContent });
      return true;
    },
  });

  const submitted = submitPromptRequest(
    {
      prompt: "hello",
      promptImages: [],
      draftContexts: [],
      activeSessionId: null,
    },
    dependencies,
  );

  assert.equal(submitted, true);
  assert.deepEqual(created, [{ initialPrompt: "hello", initialContent: undefined }]);
  assert.deepEqual(dispatched, []);
  assert.deepEqual(traces, []);
  assert.deepEqual(cleared, ["notice:", "prompt:", "images:0", "drafts:cleared"]);
  assert.deepEqual(retained, [null]);
});

test("submitPromptRequest does not add queued prompts to the conversation", async () => {
  const { dependencies, appended } = createDependencies({
    dispatch: () => Promise.resolve({ accepted: "queued" }),
  });

  const submitted = submitPromptRequest(
    {
      prompt: "queued message",
      promptImages: [],
      draftContexts: [],
      activeSessionId: "session-1",
    },
    dependencies,
  );

  assert.equal(submitted, true);
  assert.deepEqual(appended, []);
  await flushPromises();
  assert.deepEqual(appended, []);
});

test("submitPromptRequest does not dispatch when chat is restore-gated", () => {
  const { dependencies, dispatched, traces, cleared } = createDependencies();

  const submitted = submitPromptRequest(
    {
      prompt: "hello",
      promptImages: [],
      draftContexts: [],
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

test("submitPromptRequest uses the compiled payload for createSession", () => {
  const created: Array<{ text?: string; content?: unknown[] }> = [];
  const { dependencies } = createDependencies({
    createSession: (text: string, content: unknown[] | undefined) => {
      created.push({ text, content });
      return true;
    },
  });

  const ok = submitPromptRequest(
    {
      prompt: "帮我解释这段改动",
      promptImages: [],
      draftContexts: [DIFF_CONTEXT],
      activeSessionId: null,
    },
    dependencies,
  );

  assert.equal(ok, true);
  // createSession 收编译串(含 marker)——它内部转发给 ACP,review-context 必须送达。
  assert.match(created[0]?.text ?? "", /\[TILLER_CONTEXT_JSON_V1\]/);
});

test("submitPromptRequest allows context-only sends", () => {
  const created: Array<{ text?: string; content?: unknown[] }> = [];
  const { dependencies } = createDependencies({
    createSession: (text: string, content: unknown[] | undefined) => {
      created.push({ text, content });
      return true;
    },
  });

  const ok = submitPromptRequest(
    {
      prompt: "",
      promptImages: [],
      draftContexts: [DIFF_CONTEXT],
      activeSessionId: null,
    },
    dependencies,
  );

  assert.equal(ok, true);
  assert.match(created[0]?.text ?? "", /\[TILLER_CONTEXT_JSON_V1\]/);
});

test("submitPromptRequest keeps slash commands exclusive on existing sessions", async () => {
  const appended: Array<{ text: string; images: unknown[] }> = [];
  const traces: Array<{ imageCount: number; text: string }> = [];
  const retained: Array<string | null> = [];

  submitPromptRequest(
    {
      prompt: "/review now",
      promptImages: [{ type: "image", mimeType: "image/png", data: "AAA" }],
      draftContexts: [DIFF_CONTEXT],
      activeSessionId: "session-1",
    },
    createDependencies({
      appendExistingSessionPrompt: (_sessionId: string, text: string, _id: string, images: unknown[]) => appended.push({ text, images }),
      tracePromptSubmit: ({ imageCount, text }: { imageCount: number; text: string }) => traces.push({ imageCount, text }),
      setCommandRetentionNotice: (value: string | null) => retained.push(value),
    }).dependencies,
  );

  await flushPromises();
  // slash 模式:appendExistingSessionPrompt 收到的应是 slash 命令本身,不含编译 marker;
  // images 必须清空;trace imageCount=0。
  assert.equal(appended[0]?.text, "/review now");
  assert.deepEqual(appended[0]?.images, []);
  assert.equal(traces[0]?.imageCount, 0);
  assert.equal(traces[0]?.text, "/review now");
  assert.match(retained[0] ?? "", /已仅发送命令/);
});

test("submitPromptRequest splits compiled RPC text from readable transcript text", async () => {
  // context-only:RPC 路径(session/prompt)发编译串,
  // 乐观消息 appendExistingSessionPrompt 与 trace 收可读 label 兜底。
  const splitContext = {
    id: "ctx-split",
    kind: "diff" as const,
    label: "a.ts:30-34",
    comment: "split check",
    excerpt: "+ line",
    source: { kind: "diff" as const, filePath: "a.ts", startLine: 30, endLine: 34 },
  };
  const appended: Array<{ text: string }> = [];
  const dispatched: Array<{ method: string; params: { text: string } }> = [];
  const traces: Array<{ text: string }> = [];

  submitPromptRequest(
    {
      prompt: "",
      promptImages: [],
      draftContexts: [splitContext],
      activeSessionId: "session-1",
    },
    createDependencies({
      appendExistingSessionPrompt: (_sid: string, text: string) => appended.push({ text }),
      tracePromptSubmit: ({ text }: { text: string }) => traces.push({ text }),
      dispatch: (_client: unknown, method: string, params: unknown) => {
        dispatched.push({ method, params: params as { text: string } });
        return Promise.resolve({ accepted: "sent" });
      },
    }).dependencies,
  );

  await flushPromises();
  // RPC 路径(session/prompt)发编译串
  assert.equal(dispatched[0]?.method, "session/prompt");
  assert.match(dispatched[0]?.params.text ?? "", /\[TILLER_CONTEXT_JSON_V1\]/u);
  // 展示路径(乐观消息 + trace)收 label 兜底,不含 marker
  assert.equal(appended[0]?.text, "a.ts:30-34");
  assert.doesNotMatch(appended[0]?.text, /\[TILLER/u);
  assert.equal(traces[0]?.text, "a.ts:30-34");
});

test("submitPromptRequest keeps the existing image-only transcript text", async () => {
  // 防回归:纯图片发送(无文本/无 draft/有图)乐观消息应保留现状"图片 N 张"。
  const appended: Array<{ text: string; images: unknown[] }> = [];

  submitPromptRequest(
    {
      prompt: "",
      promptImages: [{ type: "image", mimeType: "image/png", data: "AAA" }],
      draftContexts: [],
      activeSessionId: "session-1",
    },
    createDependencies({
      appendExistingSessionPrompt: (_sid: string, text: string, _id: string, images: unknown[]) => appended.push({ text, images }),
    }).dependencies,
  );

  await flushPromises();
  assert.equal(appended[0]?.text, "图片 1 张");
});

test("submitPromptRequest clears retention notice after a normal prompt send", async () => {
  const cleared: Array<string | null> = [];

  submitPromptRequest(
    {
      prompt: "普通继续执行",
      promptImages: [],
      draftContexts: [],
      activeSessionId: "session-1",
    },
    createDependencies({
      setCommandRetentionNotice: (value: string | null) => cleared.push(value),
    }).dependencies,
  );

  await flushPromises();
  assert.deepEqual(cleared, [null]);
});
