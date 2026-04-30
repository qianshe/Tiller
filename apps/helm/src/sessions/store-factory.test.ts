import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHelmSessionStores, resolveSessionStoreBackend } from "./store-factory.js";

function createJsonPaths(root: string) {
  return {
    sessionHistoryPath: join(root, "sessions.json"),
    sessionMessagesPath: join(root, "session-messages"),
    sessionArtifactsPath: join(root, "session-artifacts"),
    sessionRuntimesPath: join(root, "session-runtimes.json"),
  };
}

test("resolveSessionStoreBackend defaults to sqlite and allows json override", () => {
  assert.equal(resolveSessionStoreBackend({}), "sqlite");
  assert.equal(resolveSessionStoreBackend({ TILLER_SESSION_STORE: "json" }), "json");
  assert.equal(resolveSessionStoreBackend({ TILLER_SESSION_STORE: "sqlite" }), "sqlite");
});

test("store factory honors explicit json backend", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-factory-json-"));
  try {
    const logs: string[] = [];
    const stores = createHelmSessionStores({
      backend: "json",
      sqlitePath: join(tempRoot, "sessions.sqlite"),
      jsonPaths: createJsonPaths(tempRoot),
      logInfo: (message) => logs.push(message),
    });

    assert.equal(stores.backend, "json");
    assert.equal(logs.some((message) => message.includes("backend=json")), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("store factory falls back to json when sqlite cannot open", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-factory-fallback-"));
  try {
    const errors: string[] = [];
    const stores = createHelmSessionStores({
      backend: "sqlite",
      sqlitePath: tempRoot,
      jsonPaths: createJsonPaths(tempRoot),
      logError: (message) => errors.push(message),
    });

    assert.equal(stores.backend, "json");
    assert.equal(errors.some((message) => message.includes("sqlite-fallback")), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
