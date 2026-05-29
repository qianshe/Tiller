import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderCleanupResult } from "./cleanup-results";

test("normalizeProviderCleanupResult marks successful remote deletion", () => {
  assert.deepEqual(normalizeProviderCleanupResult({
    kind: "remote-deleted",
    providerId: "codex",
    message: "deleted",
  }), {
    remoteDeleted: true,
    remoteDeletionAttempted: true,
    providerId: "codex",
    message: "deleted",
  });
});

test("normalizeProviderCleanupResult marks unsupported cleanup as not attempted", () => {
  assert.deepEqual(normalizeProviderCleanupResult({
    kind: "unsupported",
    providerId: "generic",
    message: "not supported",
  }), {
    remoteDeleted: false,
    remoteDeletionAttempted: false,
    providerId: "generic",
    message: "not supported",
  });
});
