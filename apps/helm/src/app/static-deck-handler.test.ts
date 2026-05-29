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
