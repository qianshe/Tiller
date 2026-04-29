import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderCleanupResult } from "@tiller/acp-runtime";
import { cleanupActiveRuntime } from "./sessions";

test("cleanupActiveRuntime prefers ACP session/delete over close", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: { sessionDelete: true, sessionClose: true },
    async deleteSession() {
      calls.push("delete");
      return { kind: "remote-deleted", providerId: "agent", message: "deleted" } satisfies ProviderCleanupResult;
    },
    async close() {
      calls.push("close");
      return { kind: "remote-closed", providerId: "agent", message: "closed" } satisfies ProviderCleanupResult;
    },
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "remote-deleted");
  assert.deepEqual(calls, ["delete", "cancel"]);
});

test("cleanupActiveRuntime falls back to ACP session/close when delete is unavailable", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: { sessionClose: true },
    async close() {
      calls.push("close");
      return { kind: "remote-closed", providerId: "agent", message: "closed" } satisfies ProviderCleanupResult;
    },
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "remote-closed");
  assert.deepEqual(calls, ["close"]);
});

test("cleanupActiveRuntime terminates local runtime when ACP cleanup is unsupported", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: {},
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "unsupported");
  assert.deepEqual(calls, ["cancel"]);
});
