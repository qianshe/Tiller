import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createStaticDeckHandler } from "./static-deck-handler";

type CapturedResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

function createResponse(captured: CapturedResponse): ServerResponse {
  return {
    writeHead(statusCode: number, headers: Record<string, string>) {
      captured.statusCode = statusCode;
      captured.headers = headers;
      return this;
    },
    end(body?: unknown) {
      captured.body = body;
      return this;
    },
  } as ServerResponse;
}

function createRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

test("createStaticDeckHandler serves successful assets with cache headers", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    loadStaticAsset: async (rootDir, requestUrl) => {
      assert.equal(rootDir, "/deck/dist");
      assert.equal(requestUrl, "/assets/app.js");
      return {
        ok: true,
        body: Buffer.from("console.log('ok')"),
        contentType: "text/javascript; charset=utf-8",
        immutable: true,
      };
    },
    logError: () => undefined,
  });

  await handler(createRequest("/assets/app.js"), createResponse(captured));

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.headers, {
    "cache-control": "public, max-age=31536000, immutable",
    "content-type": "text/javascript; charset=utf-8",
  });
  assert.equal((captured.body as Buffer).toString("utf8"), "console.log('ok')");
});

test("createStaticDeckHandler serves owned session attachments from the attachment store", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    sessionAttachmentStore: {
      put: () => { throw new Error("unused"); },
      get: (id) => id === "attachment-1"
        ? {
            id,
            sessionId: "session-1",
            mimeType: "image/png",
            sha256: "sha256",
            byteSize: 3,
            storageKey: "private/path/not/exposed",
            uri: "/api/sessions/session-1/attachments/attachment-1",
            createdAt: "2026-06-01T00:00:00.000Z",
          }
        : undefined,
      listForMessage: () => [],
      remove: () => undefined,
      removeSession: () => undefined,
      readBytes: (id) => id === "attachment-1" ? Buffer.from("png") : undefined,
    },
    loadStaticAsset: async () => {
      throw new Error("static loader should not handle attachment requests");
    },
    logError: () => undefined,
  });

  await handler(createRequest("/api/sessions/session-1/attachments/attachment-1"), createResponse(captured));

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.headers, {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": "image/png",
  });
  assert.equal((captured.body as Buffer).toString("utf8"), "png");
});

test("createStaticDeckHandler rejects attachments that do not belong to the requested session", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    sessionAttachmentStore: {
      put: () => { throw new Error("unused"); },
      get: () => ({
        id: "attachment-1",
        sessionId: "session-2",
        mimeType: "image/png",
        sha256: "sha256",
        byteSize: 3,
        storageKey: "private/path/not/exposed",
        uri: "/api/sessions/session-2/attachments/attachment-1",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      listForMessage: () => [],
      remove: () => undefined,
      removeSession: () => undefined,
      readBytes: () => Buffer.from("png"),
    },
    loadStaticAsset: async () => {
      throw new Error("static loader should not handle attachment requests");
    },
    logError: () => undefined,
  });

  await handler(createRequest("/api/sessions/session-1/attachments/attachment-1"), createResponse(captured));

  assert.deepEqual(captured, {
    statusCode: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: "Attachment not found.",
  });
});

test("createStaticDeckHandler serves owned session output bodies from the output store", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    sessionOutputBodyStore: {
      putText: () => {
        throw new Error("unused");
      },
      get: (sessionId, outputId) => sessionId === "session-1" && outputId === "chunk-1"
        ? {
            id: "session-1:chunk-1",
            sessionId: "session-1",
            outputId: "chunk-1",
            mimeType: "text/plain; charset=utf-8",
            sha256: "sha256",
            byteSize: 12,
            storageKey: "private/path/not/exposed",
            uri: "/api/sessions/session-1/outputs/chunk-1",
            createdAt: "2026-06-01T00:00:00.000Z",
          }
        : undefined,
      readText: (sessionId, outputId) =>
        sessionId === "session-1" && outputId === "chunk-1" ? "stdout body\n" : undefined,
      removeSession: () => undefined,
    },
    loadStaticAsset: async () => {
      throw new Error("static loader should not handle output body requests");
    },
    logError: () => undefined,
  });

  await handler(createRequest("/api/sessions/session-1/outputs/chunk-1"), createResponse(captured));

  assert.equal(captured.statusCode, 200);
  assert.deepEqual(captured.headers, {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": "text/plain; charset=utf-8",
  });
  assert.equal(captured.body, "stdout body\n");
});

test("createStaticDeckHandler rejects output bodies that do not belong to the requested session", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    sessionOutputBodyStore: {
      putText: () => {
        throw new Error("unused");
      },
      get: () => undefined,
      readText: () => undefined,
      removeSession: () => undefined,
    },
    loadStaticAsset: async () => {
      throw new Error("static loader should not handle output body requests");
    },
    logError: () => undefined,
  });

  await handler(createRequest("/api/sessions/session-1/outputs/chunk-1"), createResponse(captured));

  assert.deepEqual(captured, {
    statusCode: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: "Output body not found.",
  });
});

test("createStaticDeckHandler serves complete diff bodies through their local reference", async () => {
  const captured: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    sessionDiffBodyStore: {
      putText: () => {
        throw new Error("unused");
      },
      get: (sessionId, path) => sessionId === "session-1" && path === "src/file.ts"
        ? {
            id: "diff-1",
            sessionId,
            path,
            mimeType: "text/plain; charset=utf-8",
            sha256: "sha256",
            byteSize: 12,
            storageKey: "private/path/not/exposed",
            uri: "/api/sessions/session-1/diffs/src%2Ffile.ts",
            createdAt: "2026-07-12T00:00:00.000Z",
          }
        : undefined,
      readText: () => "diff body\n",
      removeSession: () => undefined,
    },
    loadStaticAsset: async () => {
      throw new Error("static loader should not handle diff body requests");
    },
    logError: () => undefined,
  });

  await handler(createRequest("/api/sessions/session-1/diffs/src%2Ffile.ts"), createResponse(captured));

  assert.equal(captured.statusCode, 200);
  assert.equal(captured.body, "diff body\n");
});

test("createStaticDeckHandler preserves not-found and forbidden responses", async () => {
  const notFound: CapturedResponse = {};
  const forbidden: CapturedResponse = {};
  const handler = createStaticDeckHandler({
    deckStaticDir: "/deck/dist",
    loadStaticAsset: async (_rootDir, requestUrl) =>
      requestUrl === "/missing.js" ? { ok: false, statusCode: 404 } : { ok: false, statusCode: 403 },
    logError: () => undefined,
  });

  await handler(createRequest("/missing.js"), createResponse(notFound));
  await handler(createRequest("/../secret.txt"), createResponse(forbidden));

  assert.deepEqual(notFound, {
    statusCode: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: "Tiller Deck assets not found. Run pnpm --filter @tiller/helm build.",
  });
  assert.deepEqual(forbidden, {
    statusCode: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: "Forbidden",
  });
});
