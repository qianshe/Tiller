import assert from "node:assert/strict";
import test from "node:test";
import config, { createNoStoreDevServerPlugin } from "./vite.config.js";

test("deck dev server disables browser cache for module responses", () => {
  assert.equal(config.server?.headers?.["Cache-Control"], "no-store");
});

test("deck dev server strips conditional cache headers before Vite handles modules", () => {
  const plugin = createNoStoreDevServerPlugin();
  let middleware: ((req: any, res: any, next: () => void) => void) | undefined;
  plugin.configureServer?.({
    middlewares: {
      use(handler: typeof middleware) {
        middleware = handler;
      },
    },
  } as any);

  assert.ok(middleware);
  const req = {
    headers: {
      "if-modified-since": "Sun, 31 May 2026 00:00:00 GMT",
      "if-none-match": "cached-etag",
    },
  };
  const headers: Record<string, string> = {};
  let nextCalled = false;

  middleware(req, {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  }, () => {
    nextCalled = true;
  });

  assert.equal(req.headers["if-none-match"], undefined);
  assert.equal(req.headers["if-modified-since"], undefined);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(nextCalled, true);
});
